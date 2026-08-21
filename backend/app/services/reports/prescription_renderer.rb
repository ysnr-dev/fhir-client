module Reports
  # 処方箋を ThinReports レイアウトへ流し込んで PDF を生成する
  # (docs/prescription-report-design.md)。院外(様式第2号)と院内(簡易様式)は
  # レイアウトファイルが違うだけで流し込みは同じなので、レンダラは 1 つ。
  # レイアウトに存在しないプレースホルダーは黙って捨てる(既存レンダラと同じ)ため、
  # 院内レイアウトに医療機関コード欄が無い、といった差はここで吸収される。
  #
  # プレースホルダー規約は docs/report-mappings/prescription-01.md を参照。
  #
  # 処方内容(RP 明細)は 1 個の text-block(rx_content)に整形済みの行を流し込む。
  # 行数がレイアウトの枠を超えるときは同じレイアウトで続紙を起こす。折り返しを
  # ThinReports 任せにすると 1 ページに入る行数が読めなくなるので、折り返しは
  # ここで済ませて(wrap)、枠の行数(lines_per_page)との対応を決定的にする。
  class PrescriptionRenderer
    # layout_path: 同梱の .tlf のパス
    # order/patient/organization: パース済み FHIR リソース(Hash。organization は自院、nil 可)
    # rps: PrescriptionReport::RpGroup の配列
    # lines_per_page/max_cols: レイアウトの処方欄に入る行数・桁数(半角換算)
    def initialize(layout_path:, order:, patient:, organization:, rps:, lines_per_page:, max_cols:)
      @layout_path = layout_path
      @order = order
      @patient = patient
      @organization = organization
      @rps = rps
      @lines_per_page = lines_per_page
      @max_cols = max_cols
    end

    def render
      text_ids, _image_ids, all_ids = layout_item_ids
      pages = rp_lines.flat_map { |line| wrap(line) }.each_slice(@lines_per_page).to_a
      pages = [[]] if pages.empty?

      report = Thinreports::Report.new(layout: @layout_path.to_s)
      pages.each_with_index do |lines, index|
        report.start_new_page do |page|
          values = page_values.merge(
            "rx_content" => lines.join("\n"),
            "page_no" => "#{index + 1} / #{pages.size}"
          )
          values.each { |id, value| page.item(id).value(value) if text_ids.include?(id) }
          if all_ids.include?("continued")
            index < pages.size - 1 ? page.item("continued").show : page.item("continued").hide
          end
        end
      end
      report.generate
    end

    private

    # RP 1 件を「Rp 見出し → 薬品 → 用法」の順の行にする。カルテの紹介状に流し込む
    # 処方文字列(frontend の populateContext.ts formatPrescriptions)と同じ並び。
    # 画面と紙で処方の読み方が変わらないよう、変えるときは両方を揃えること。
    def rp_lines
      @rps.flat_map do |rp|
        lines = ["Rp#{rp.rp_number}"]
        rp.medicines.each do |medicine|
          dose = medicine.dose.present? ? " #{medicine.dose}#{medicine.unit}" : ""
          comment = medicine.comment.present? ? "（#{medicine.comment}）" : ""
          lines << "　#{medicine.name}#{dose}#{comment}"
        end
        amount =
          if rp.dose_days.present?
            "#{rp.dose_days}日分"
          elsif rp.dose_count.present?
            "#{rp.dose_count}回分"
          else
            ""
          end
        usage = [rp.usage_name, amount].compact_blank.join(" ")
        usage_comment = rp.usage_comment.present? ? "（#{rp.usage_comment}）" : ""
        lines << "　用法: #{usage}#{usage_comment}" if usage.present? || usage_comment.present?
        lines
      end
    end

    # 長い行を桁数(半角換算。全角 = 2)で折り返す。継続行は全角空白 1 つで字下げして
    # 薬品名の続きだと分かるようにする。
    def wrap(line)
      chunks = []
      current = +""
      cols = 0
      limit = @max_cols
      line.each_char do |char|
        width = char.ascii_only? ? 1 : 2
        if cols + width > limit
          chunks << current
          current = +"　"
          cols = 2
          limit = @max_cols
        end
        current << char
        cols += width
      end
      chunks << current
      chunks
    end

    def page_values
      {
        "pt_id" => PatientMeta.identifier(@patient),
        "pt_name" => PatientMeta.display_name(@patient),
        "pt_kana" => PatientMeta.display_kana(@patient),
        "pt_gender" => PatientMeta.gender_label(@patient),
        "pt_birthdate" => PatientMeta.format_date(@patient["birthDate"]),
        # 交付年月日は処方日(authoredOn)。発行操作の日ではないので、再発行しても
        # 同じ日付が刷られる(docs/prescription-report-design.md)。
        "issue_date" => PatientMeta.format_date(@order["authoredOn"].to_s.first(10)),
        "doctor_name" => @order.dig("requester", "display").to_s,
        "department_name" => department_name,
        "rx_category" => rx_category,
        "remarks" => @order.dig("note", 0, "text").to_s
      }.merge(hospital_values)
    end

    def department_name
      extension = Array(@order["extension"]).find do |ext|
        ext["url"] == PrescriptionReport::ORDER_DEPARTMENT_EXT_URL
      end
      extension&.dig("valueReference", "display").to_s
    end

    # 「外来 院内」「入院 定期」のような区分表示(院内レイアウト用)。
    def rx_category
      displays = Array(@order["category"]).filter_map do |category|
        Array(category["coding"]).find do |coding|
          [PrescriptionReport::SETTING_SYSTEM,
           PrescriptionReport::PRESCRIPTION_CATEGORY_SYSTEM].include?(coding["system"])
        end&.dig("display")
      end
      displays.join(" ")
    end

    # 自院(保険医療機関)の欄。Organization が引けなくても発行は止めない(空欄で刷る)。
    def hospital_values
      org = @organization || {}
      address = org.dig("address", 0) || {}
      address_text = [address["postalCode"].presence &&
                        "〒#{address['postalCode']}", address["text"]].compact.join(" ")
      {
        "hospital_name" => org["name"].to_s,
        "hospital_address" => address_text,
        "hospital_tel" => telecom_value(org, "phone"),
        "hospital_fax" => telecom_value(org, "fax")
      }.merge(institution_number_values(org))
    end

    def telecom_value(org, system)
      Array(org["telecom"]).find { |t| t["system"] == system }&.dig("value").to_s
    end

    # 保険医療機関コード(10 桁 = 都道府県 2 + 点数表 1 + 医療機関コード 7)を
    # 様式の 3 つの枠に分ける。10 桁でない値はコード欄にそのまま刷る。
    def institution_number_values(org)
      number = Array(org["identifier"]).find do |identifier|
        identifier["system"] == PrescriptionReport::INSTITUTION_NO_SYSTEM
      end&.dig("value").to_s
      if number.match?(/\A\d{10}\z/)
        { "pref_no" => number[0, 2], "table_no" => number[2, 1], "inst_no" => number[3, 7] }
      else
        { "pref_no" => "", "table_no" => "", "inst_no" => number }
      end
    end

    # レイアウト内のアイテム ID を種類別に列挙する(LabLabelRenderer と同じ理由:
    # 未知の ID へ page.item すると例外になるため、設定対象を絞るのに使う)。
    def layout_item_ids
      items = JSON.parse(File.read(@layout_path)).fetch("items", [])
      text_ids = Set.new
      image_ids = Set.new
      all_ids = Set.new
      items.each do |item|
        id = item["id"].to_s
        next if id.empty?

        all_ids << id
        case item["type"]
        when "text-block" then text_ids << id
        when "image-block" then image_ids << id
        end
      end
      [text_ids, image_ids, all_ids]
    end
  end
end
