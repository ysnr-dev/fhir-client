# DPC 様式1(退院患者調査)の提出ファイル(FF1)を組む。
# 様式1 は入院 1 件につき 1 つの QuestionnaireResponse として上流 FHIR サーバーにあり、
# ここでは対象月に退院した入院を集めて、確定済みのものをタブ区切りの行に展開する。
#   Encounter 検索(退院月に重なる入院) → QuestionnaireResponse 検索(入院をまとめて指定)
#
# 読むだけで副作用は無い(何度呼んでも同じ結果)。対象月は引数だけで決める
# (backend の Date.current は UTC で、JST の朝は前日になるため使わない)。
class DpcForm1Export
  # month が YYYY-MM として読めない
  class InvalidMonth < StandardError; end
  # 確定済みの様式1 が 1 件も無く、ファイルにする中身がない
  class NothingToExport < StandardError; end

  # 様式1 の QuestionnaireResponse.questionnaire(frontend の fhir/dpcForm1 と同じ値)。
  QUESTIONNAIRE_URL = "http://fhir-client.local/Questionnaire/dpc-form1".freeze
  # 入退院の日付は日本時間の暦日で数える。
  TIME_ZONE = "Asia/Tokyo".freeze

  # 提出ファイルの文字コードと改行。実施説明資料(2026 年度版)は様式1 について明記していないため、
  # 同じ資料の他ファイル(K ファイル生成用データ・レセプトデータダウンロード方式)の「シフト JIS」と
  # 提出支援ツールが Windows 用であることに合わせている。
  ENCODING = "Windows-31J".freeze
  LINE_BREAK = "\r\n".freeze
  PAYLOAD_COUNT = 9
  # 1 行目のヘッダー。実施説明資料(2025 年度版)は「指定するヘッダーが必要」とだけ述べ、文言は
  # 提出支援ツール同梱のセットアップマニュアルにあって公開されていない。ここはファイルレイアウト例の
  # 列名を並べたもので、ツールの指定と違う場合はこの定数だけを直す(nil にするとヘッダー行を出さない)。
  HEADER_ROW = (
    %w[施設コード データ識別番号 入院年月日 回数管理番号 統括診療情報番号 コード バージョン 連番] +
    (1..PAYLOAD_COUNT).map { |n| "ペイロード#{n}" }
  ).freeze

  # ファイルに出す状態(確定・確定後の修正)。下書きは出さない。
  EXPORT_STATUSES = %w[completed amended].freeze
  # 入院の検索は上流の 1 回の上限いっぱいで引き、link[next] を追う。
  PAGE_SIZE = 500
  SEARCH_LIMIT = 100_000
  # 様式1 を 1 回の検索で引く入院の数(URL が長くなりすぎない範囲)。
  ENCOUNTER_CHUNK = 50

  # Unicode では別の文字だが Windows-31J では同じ字形に割り当てられている記号。
  # 変換表に無い側で入力されることが多い(macOS の「〜」「−」など)ので寄せておく。
  WINDOWS_31J_EQUIVALENTS = {
    "〜" => "～", "−" => "－", "‖" => "∥", "—" => "―",
    "¢" => "￠", "£" => "￡", "¬" => "￢"
  }.freeze

  # 様式1 1 件ぶん。header はヘッダ部の 5 項目、records は [コード, バージョン, 連番, ペイロード1〜9]。
  Form = Struct.new(:encounter, :response, :header, :records, keyword_init: true)

  def initialize(month:, store: Integrations::FhirStore.new)
    matched = month.to_s.match(/\A(\d{4})-(0[1-9]|1[0-2])\z/)
    raise InvalidMonth, "month must be YYYY-MM" unless matched

    @month = month.to_s
    @first_day = Date.new(matched[1].to_i, matched[2].to_i, 1)
    @last_day = @first_day.end_of_month
    @store = store
  end

  # 対象入院の一覧と警告。ファイルを作る前の確認画面に出す。
  def summary
    build
    {
      month: month,
      filename: @forms.empty? ? nil : filename,
      facility_code: facility_code,
      encounters: @rows,
      warnings: @warnings,
      exported_count: @forms.size,
      excluded_count: @rows.size - @forms.size,
      record_count: @forms.sum { |form| form.records.size }
    }
  end

  # ファイル本体(エンコード済みのバイト列)。
  def file
    build
    raise NothingToExport, "no completed form1 in #{month}" if @forms.empty?

    @file
  end

  # FF1_{施設コード}_{退院年月 yymm}.txt(実施説明資料のデータ提出フローの元ファイル名)
  def filename
    build
    "FF1_#{facility_code}_#{@first_day.strftime('%y%m')}.txt"
  end

  private

  attr_reader :month, :store

  def build
    return if @built

    @warnings = []
    encounters = discharged_encounters
    responses = responses_by_encounter(encounters)
    @rows = encounters.map { |encounter| encounter_row(encounter, responses[encounter["id"]]) }
    @forms = encounters.filter_map { |encounter| build_form(encounter, responses[encounter["id"]]) }
                       .sort_by(&:header)
    check_facility_codes
    @file = encode_file
    @built = true
  end

  # ---- 上流からの取得 ----

  # 対象月に退院した入院。上流の date 検索は期間の重なりなので、月をまたいで
  # 入院していただけのものも返る。退院日(日本時間)が対象月のものだけを残す。
  def discharged_encounters
    found = store.search(
      "Encounter",
      { "class" => "IMP", "status" => "finished",
        "date" => ["ge#{@first_day.iso8601}", "le#{@last_day.iso8601}"], "_count" => PAGE_SIZE },
      limit: SEARCH_LIMIT
    )
    found.uniq { |encounter| encounter["id"] }
         .select { |encounter| (@first_day..@last_day).cover?(local_date(encounter.dig("period", "end"))) }
         .sort_by { |encounter| [local_date(encounter.dig("period", "end")), encounter["id"].to_s] }
  end

  # 入院 id => 様式1。同じ入院に複数あれば最後に更新されたものを使い、警告に出す。
  def responses_by_encounter(encounters)
    grouped = Hash.new { |hash, key| hash[key] = [] }
    encounters.each_slice(ENCOUNTER_CHUNK) do |chunk|
      found = store.search(
        "QuestionnaireResponse",
        { "questionnaire" => QUESTIONNAIRE_URL,
          "encounter" => chunk.map { |encounter| "Encounter/#{encounter['id']}" }.join(","),
          "_count" => PAGE_SIZE },
        limit: SEARCH_LIMIT
      )
      found.each do |response|
        encounter_id = response.dig("encounter", "reference").to_s[%r{Encounter/([^/]+)\z}, 1]
        grouped[encounter_id] << response if encounter_id
      end
    end

    by_id = encounters.index_by { |encounter| encounter["id"] }
    grouped.slice(*by_id.keys).to_h do |encounter_id, candidates|
      latest = candidates.uniq { |r| r["id"] }.max_by { |r| r.dig("meta", "lastUpdated").to_s }
      if candidates.uniq { |r| r["id"] }.size > 1
        warn_on(by_id[encounter_id], "duplicate_response",
                "同じ入院に様式1 が #{candidates.size} 件あります(最後に更新された #{latest['id']} を使用)")
      end
      [encounter_id, latest]
    end
  end

  # ---- 一覧 ----

  def encounter_row(encounter, response)
    {
      encounter_id: encounter["id"],
      patient_id: patient_id(encounter),
      patient_display: encounter.dig("subject", "display"),
      admit_date: local_date(encounter.dig("period", "start"))&.iso8601,
      discharge_date: local_date(encounter.dig("period", "end"))&.iso8601,
      form1_status: response ? response["status"] : "none",
      questionnaire_response_id: response&.dig("id")
    }
  end

  # ---- 行への展開 ----

  def build_form(encounter, response)
    return nil unless response && EXPORT_STATUSES.include?(response["status"])

    groups = Array(response["item"])
    header_answers = answers(groups.find { |group| group["linkId"] == "header" }, "header")
    header = %w[facility dataId admitDate count summaryNo].map { |key| header_answers[key].to_s }
    if header.any?(&:empty?)
      warn_on(encounter, "header_incomplete", "ヘッダ部に空の項目があります")
    end

    records = groups.reject { |group| group["linkId"] == "header" }
                    .filter_map { |group| build_record(encounter, group) }
                    .sort_by { |code, version, seq, *| [code, version, seq.to_i] }
    Form.new(encounter:, response:, header:, records:)
  end

  # レコード 1 件。ペイロード 1〜9 がすべて空なら作らない。
  def build_record(encounter, group)
    code = group["linkId"].to_s
    values = answers(group, code)
    payloads = (1..PAYLOAD_COUNT).map { |n| clean_payload(encounter, code, values["p#{n}"].to_s) }
    return nil if payloads.all?(&:empty?)

    [code, values["ver"].to_s, values["seq"].presence || "0", *payloads]
  end

  # グループ直下の回答を、linkId の接頭辞(「A000010.」)を外したキーで引けるようにする。
  def answers(group, prefix)
    Array(group&.dig("item")).each_with_object({}) do |item, hash|
      key = item["linkId"].to_s.delete_prefix("#{prefix}.")
      hash[key] = item.dig("answer", 0, "valueString")
    end
  end

  # タブ・改行は列と行の区切りを壊すので空白に置き換える(提出支援ツールもエラーにする)。
  def clean_payload(encounter, code, value)
    return value unless value.match?(/[\t\r\n]/)

    warn_on(encounter, "control_character", "#{code} にタブまたは改行が含まれています(空白に置換)", code:)
    value.gsub(/[\t\r\n]+/, " ")
  end

  # ---- 施設コード ----

  # ファイル名に使う施設コード。出力する様式1 のヘッダ部で最も多い値。
  def facility_code
    build
    @facility_code
  end

  def check_facility_codes
    code = @forms.map { |form| form.header[0] }.reject(&:empty?).tally.max_by { |_, count| count }&.first
    @facility_code = code
    @forms.each do |form|
      value = form.header[0]
      if value != code
        warn_on(form.encounter, "facility_code_mismatch",
                "施設コード「#{value}」が他の様式1(#{code})と一致しません")
      elsif !value.match?(/\A\d{9}\z/)
        warn_on(form.encounter, "facility_code_format", "施設コード「#{value}」が半角数字 9 桁ではありません")
      end
    end
  end

  # ---- ファイル ----

  def encode_file
    lines = []
    lines << HEADER_ROW.join("\t").encode(ENCODING) if HEADER_ROW
    @forms.each do |form|
      form.records.each do |record|
        lines << encode_line(form, record)
      end
    end
    lines.map { |line| line + LINE_BREAK.encode(ENCODING) }.join.force_encoding(Encoding::BINARY)
  end

  # 変換表に無い文字は「?」に置き換えて出力を続け、どのレコードで起きたかを警告に残す。
  def encode_line(form, record)
    replaced = []
    text = (form.header + record).join("\t").scrub("?")
                                 .gsub(/[#{WINDOWS_31J_EQUIVALENTS.keys.join}]/o, WINDOWS_31J_EQUIVALENTS)
    line = text.encode(ENCODING, fallback: lambda { |char|
      replaced << char
      "?"
    })
    if replaced.any?
      warn_on(form.encounter, "unencodable_character",
              "#{record[0]} に Shift_JIS へ変換できない文字「#{replaced.uniq.join}」があります(? に置換)",
              code: record[0])
    end
    line
  end

  # ---- 補助 ----

  def warn_on(encounter, type, message, code: nil)
    @warnings << {
      type: type,
      message: message,
      encounter_id: encounter["id"],
      patient_id: patient_id(encounter),
      patient_display: encounter.dig("subject", "display"),
      code: code
    }
  end

  def patient_id(encounter)
    encounter.dig("subject", "reference").to_s[%r{Patient/([^/]+)\z}, 1]
  end

  # FHIR の date / dateTime を日本時間の暦日にする。時刻の無い値はその日付のまま。
  def local_date(value)
    text = value.to_s
    return nil if text.empty?
    return Date.iso8601(text) if text.match?(/\A\d{4}-\d{2}-\d{2}\z/)

    Time.iso8601(text).in_time_zone(TIME_ZONE).to_date
  rescue ArgumentError
    nil
  end
end
