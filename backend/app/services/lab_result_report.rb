# 検体検査結果 1 件(DiagnosticReport)の報告書 PDF のオーケストレータ。
# 上流からレポート・項目(Observation)・患者・自院 Organization を batch Bundle 1 本で取得し、
# 検査分野ごとに畳んでレンダラへ渡す。読むだけで副作用は無い。
#   batch Bundle POST / -- レポート検索(項目と患者を _include)+ 自院 Organization
#
# 分野の振り分け・値の表示は検査結果の内容表示(frontend の LabResultDetailPanel・
# fhir/labResultHelpers.ts)と同じ規則。材料は刷らない。
class LabResultReport
  include Reports::UpstreamBundle

  class NotFound < StandardError; end
  class NotLabResult < StandardError; end
  class UpstreamError < StandardError; end

  # 同梱レイアウト(A4 縦、左右 2 段の list)。処方箋と同じくマスタ(report_layouts)には登録しない。
  LAYOUT_PATH = Rails.root.join("lib/report_layouts/lab_result.tlf").freeze

  # frontend の fhir/labResultHelpers.ts と同じ system 定義。
  REPORT_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0074".freeze
  LAB_CATEGORY_CODE = "LAB".freeze
  SETTING_SYSTEM = "http://fhir-client.local/CodeSystem/lab-result-setting".freeze
  RESULT_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/lab-result-item".freeze
  JLAC11_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11".freeze
  ABBREVIATION_SYSTEM = LabLabelReport::ABBREVIATION_SYSTEM
  INTERPRETATION_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation".freeze
  ORDER_DEPARTMENT_EXT_URL = PrescriptionReport::ORDER_DEPARTMENT_EXT_URL

  # 分野の並び(frontend の LAB_CATEGORIES と同じ)。ここに無い分野は末尾、引けない項目は「その他」。
  CATEGORIES = %w[
    尿・糞便等検査 血液学的検査 生化学検査 免疫学的検査 免疫血液学的検査 内分泌学的検査
    感染症関連検査 微生物学的検査 遺伝子関連・染色体検査 病理学的検査 その他
  ].freeze
  UNKNOWN_CATEGORY = "その他".freeze
  # 表に出す判定。N(および未記録)は印を出さない。
  INTERPRETATIONS = %w[HH H L LL].freeze
  STATUS_DISPLAYS = {
    "preliminary" => "中間報告", "final" => "最終報告", "corrected" => "訂正報告", "amended" => "訂正報告"
  }.freeze

  # JLAC11 の読み替え(frontend の jlac11AliasKey)。17 桁のうち測定物・識別・材料の 12 桁が
  # 同じなら、測定法・結果単位が違っても同じ結果項目と見なす。
  JLAC11_LENGTH = 17
  JLAC11_ALIAS_LENGTH = 12

  Summary = Struct.new(:date, :setting, :department, :status, :issued, :conclusion, keyword_init: true)
  Group = Struct.new(:category, :lines, keyword_init: true)
  Line = Struct.new(:name, :value, :flag, :unit, :range, :note, keyword_init: true)

  def initialize(report_id, gateway: FhirGateway.new)
    @report_id = report_id
    @gateway = gateway
  end

  def generate
    report, observations, patient, organization = fetch_resources
    Reports::LabResultRenderer.new(
      layout_path: LAYOUT_PATH, patient:, organization:,
      summary: build_summary(report), groups: build_groups(observations),
      printed_at: FacilityClock.now
    ).render
  end

  private

  attr_reader :report_id, :gateway

  def fetch_resources
    self_organization_id = FacilitySettings.self_organization_id
    entries = [
      { "request" => { "method" => "GET",
                       "url" => "DiagnosticReport?_id=#{CGI.escape(report_id)}" \
                                "&_include=DiagnosticReport%3Aresult" \
                                "&_include=DiagnosticReport%3Asubject" } },
      { "request" => { "method" => "GET", "url" => institution_url(self_organization_id) } }
    ]
    bundle = { "resourceType" => "Bundle", "type" => "batch", "entry" => entries }
    upstream = gateway.forward(
      method: :post, path: "/", body: bundle.to_json,
      headers: { "Content-Type" => "application/fhir+json" }
    )
    ensure_success!(upstream, "batch bundle")
    results = Array(JSON.parse(upstream.body)["entry"])

    resources = searchset_resources(results[0], nil, "DiagnosticReport?_id=#{report_id}")
    report = resources.find { |r| r["resourceType"] == "DiagnosticReport" && r["id"] == report_id }
    raise NotFound, "DiagnosticReport/#{report_id} not found" unless report
    raise NotLabResult, "DiagnosticReport/#{report_id} is not a lab result" unless lab_result?(report)

    [report, ordered_observations(report, resources), included_patient(resources, report),
     find_institution(results[1], self_organization_id)]
  end

  # 細菌検査(MB)・病理など、同じ DiagnosticReport でも検体検査以外は刷らない。
  def lab_result?(report)
    Array(report["category"]).any? do |category|
      coding_by_system(category["coding"], REPORT_CATEGORY_SYSTEM)&.dig("code") == LAB_CATEGORY_CODE
    end
  end

  # _include の順序は不定なので、DiagnosticReport.result の参照順(登録時の並び)に揃える。
  def ordered_observations(report, resources)
    by_id = resources.select { |r| r["resourceType"] == "Observation" }.index_by { |r| r["id"] }
    Array(report["result"]).filter_map do |ref|
      by_id[ref["reference"].to_s.delete_prefix("Observation/")]
    end
  end

  def build_summary(report)
    Summary.new(
      date: Reports::PatientMeta.format_date(report["effectiveDateTime"].to_s[0, 10]),
      setting: Array(report["category"]).filter_map do |category|
        coding_by_system(category["coding"], SETTING_SYSTEM)&.dig("display")
      end.first.to_s,
      department: Array(report["extension"]).find { |e| e["url"] == ORDER_DEPARTMENT_EXT_URL }
                    &.dig("valueReference", "display").to_s,
      status: STATUS_DISPLAYS.fetch(report["status"].to_s, ""),
      issued: issued_label(report["issued"]),
      conclusion: report["conclusion"].to_s
    )
  end

  def issued_label(instant)
    return "" if instant.blank?

    Time.zone.parse(instant).in_time_zone(FacilityClock::ZONE).strftime("%Y/%m/%d %H:%M")
  rescue ArgumentError
    instant.to_s
  end

  # ---- 検査分野ごとのまとめ(frontend の groupByCategory と同じ規則) ----

  def build_groups(observations)
    categories = category_lookup(observations)
    grouped = observations.group_by { |obs| categories[item_key(obs)] || UNKNOWN_CATEGORY }
    grouped.sort_by { |category, _| CATEGORIES.index(category) || CATEGORIES.size }
           .map { |category, list| Group.new(category:, lines: list.map { |obs| build_line(obs) }) }
  end

  # 結果項目コード → 分野。施設コードを持たない結果(JLAC11 のみ)は JLAC11 の 12 桁で
  # 結果項目を引き当てて読み替える(@aliases)。
  def category_lookup(observations)
    codes = observations.filter_map { |obs| code_of(obs, RESULT_ITEM_SYSTEM) }.uniq
    legacy_keys = observations.filter_map do |obs|
      next if code_of(obs, RESULT_ITEM_SYSTEM)

      alias_key(code_of(obs, JLAC11_SYSTEM).to_s).presence
    end.uniq

    @aliases = {}
    if legacy_keys.any?
      Master::LabResultItem
        .where("jlac11_code LIKE ANY (ARRAY[?])", legacy_keys.map { |key| "#{key}%" })
        .order(Arel.sql("display_order NULLS LAST"))
        .each do |item|
          key = alias_key(item.jlac11_code.to_s)
          @aliases[key] ||= item.result_item_code if key.present?
        end
    end

    Master::LabResultItem.where(result_item_code: codes + @aliases.values)
                         .where.not(category: [nil, ""])
                         .to_h { |item| [item.result_item_code, item.category] }
  end

  def item_key(obs)
    code_of(obs, RESULT_ITEM_SYSTEM) || @aliases[alias_key(code_of(obs, JLAC11_SYSTEM).to_s)]
  end

  def alias_key(jlac11)
    jlac11.length == JLAC11_LENGTH ? jlac11[0, JLAC11_ALIAS_LENGTH] : ""
  end

  def code_of(obs, system)
    coding_by_system(obs.dig("code", "coding"), system)&.dig("code").presence
  end

  def build_line(obs)
    value, unit = value_and_unit(obs)
    flag = Array(obs["interpretation"]).filter_map do |concept|
      coding_by_system(concept["coding"], INTERPRETATION_SYSTEM)&.dig("code")
    end.first.to_s
    Line.new(
      name: item_name(obs), value:, unit:,
      flag: INTERPRETATIONS.include?(flag) ? flag : "",
      range: reference_range(obs),
      note: Array(obs["note"]).filter_map { |note| note["text"].presence }.join(" / ")
    )
  end

  # 略称があれば略称(内容表示と同じ)。無ければ施設コード → JLAC11 → text の順の名称。
  def item_name(obs)
    codings = obs.dig("code", "coding")
    [ABBREVIATION_SYSTEM, RESULT_ITEM_SYSTEM, JLAC11_SYSTEM].each do |system|
      display = coding_by_system(codings, system)&.dig("display")
      return display if display.present?
    end
    obs.dig("code", "text").to_s
  end

  def value_and_unit(obs)
    if (quantity = obs["valueQuantity"])
      [quantity["value"].nil? ? "" : format_number(quantity["value"]), quantity["unit"].to_s]
    elsif (concept = obs["valueCodeableConcept"])
      [concept.dig("coding", 0, "display").presence || concept["text"].to_s, ""]
    else
      [obs["valueString"].to_s, ""]
    end
  end

  # 「6.6〜8.1」「〜0.14」「3.3〜」(frontend の referenceRangeLabel)。
  def reference_range(obs)
    range = Array(obs["referenceRange"]).first
    return "" unless range

    low = range.dig("low", "value")
    high = range.dig("high", "value")
    return "" if low.nil? && high.nil?

    "#{low.nil? ? '' : format_number(low)}〜#{high.nil? ? '' : format_number(high)}"
  end

  # JSON の数値をそのまま(整数は小数点なし)。frontend の String(number) と同じ見た目にする。
  def format_number(number)
    number.is_a?(Float) && number == number.floor && number.abs < 1e15 ? number.to_i.to_s : number.to_s
  end
end
