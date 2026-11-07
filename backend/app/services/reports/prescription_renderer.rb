require "stringio"

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
  #
  # QR コードの枠(image-block qr_1, qr_2, …)を持つレイアウトでは、JAHIS の記録 CSV を
  # QR コードにして枠に置く。シンボルが分割されたときは 1 ページ目の枠から順に埋め、
  # 枠が足りなければ続紙の枠に送る。
  class PrescriptionRenderer
    # 後発品変更不可の欄。様式第2号は薬品の行の左に「変更不可」「患者希望」の列を持ち、
    # 該当する薬品の 1 行目に「レ」を刷る。列の無いレイアウト(院内)は薬品名の後ろに書く。
    SUBSTITUTION_COLUMNS = {
      PrescriptionReport::MEDICAL_NECESSITY => "rx_no_change",
      PrescriptionReport::PATIENT_REQUEST => "rx_patient_wish"
    }.freeze
    SUBSTITUTION_LABELS = {
      PrescriptionReport::MEDICAL_NECESSITY => "【変更不可】",
      PrescriptionReport::PATIENT_REQUEST => "【患者希望】"
    }.freeze
    SUBSTITUTION_CHECK = "レ".freeze

    # 処方箋を渡された順に 1 つの PDF へ並べる。prescriptions の各要素は new の引数で、
    # 様式(用紙)の違う処方箋が混ざってもよい。
    def self.render(prescriptions)
      report = Thinreports::Report.new
      prescriptions.each { |prescription| new(**prescription).draw(report) }
      report.generate
    end

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

    # レイアウトの QR コードの枠が足りない(連結の上限まで分割しても入らない)。
    class QrOverflow < StandardError; end

    # この処方箋のページを report に足す。
    def draw(report)
      text_ids, image_ids, all_ids = layout_item_ids
      columns = SUBSTITUTION_COLUMNS.values.all? { |id| text_ids.include?(id) }
      qr_slots = image_ids.grep(/\Aqr_\d+\z/).sort_by { |id| id.delete_prefix("qr_").to_i }
      qr_pngs = qr_slots.any? ? qr_symbol_pngs : []
      # 行は [文字列, 後発品変更不可] の組。折り返した継続行には印を付けない。
      rows = rp_lines(columns:).flat_map do |line, block|
        wrap(line).each_with_index.map { |chunk, i| [chunk, i.zero? ? block : nil] }
      end
      pages = rows.each_slice(@lines_per_page).to_a
      pages = [[]] if pages.empty?

      pages.each_with_index do |lines, index|
        report.start_new_page(layout: @layout_path.to_s) do |page|
          values = page_values.merge(
            "rx_content" => lines.map(&:first).join("\n"),
            "page_no" => "#{index + 1} / #{pages.size}"
          )
          SUBSTITUTION_COLUMNS.each do |block, id|
            values[id] = lines.map { |_, b| b == block ? SUBSTITUTION_CHECK : "" }.join("\n")
          end
          values.each { |id, value| page.item(id).value(value) if text_ids.include?(id) }
          if all_ids.include?("continued")
            index < pages.size - 1 ? page.item("continued").show : page.item("continued").hide
          end
          place_qr_symbols(page, qr_slots, qr_pngs, index, text_ids)
        end
      end
      if qr_pngs.size > qr_slots.size * pages.size
        raise QrOverflow, "#{qr_pngs.size} QR symbols for #{qr_slots.size * pages.size} slots"
      end
    end

    private

    # JAHIS の記録 CSV を QR コードの画像にする(分割されれば複数)。
    def qr_symbol_pngs
      data = PrescriptionQrData.new(order: @order, patient: @patient, organization: @organization, rps: @rps)
      PrescriptionQrSymbols.new(data.lines).pngs
    end

    # このページぶんのシンボルを枠に置く。余った枠は空のまま(画像を置かない)。
    # 添え書き(qr_label_n)は分割されたときだけ「n / 総数」。
    def place_qr_symbols(page, slots, pngs, page_index, text_ids)
      slots.each_with_index do |slot, i|
        symbol_index = page_index * slots.size + i
        png = pngs[symbol_index]
        next unless png

        page.item(slot).src(StringIO.new(png))
        label = "#{slot.sub('qr_', 'qr_label_')}"
        next unless text_ids.include?(label)

        page.item(label).value(pngs.size > 1 ? "#{symbol_index + 1} / #{pngs.size}" : "")
      end
    end

    # RP 1 件を「Rp 見出し → 薬品 → 用法 → 調剤指示」の順の行にする。カルテの紹介状に流し込む
    # 処方文字列(frontend の populateContext.ts formatPrescriptions)と同じ並び。
    # 画面と紙で処方の読み方が変わらないよう、変えるときは両方を揃えること。
    # 後発品変更不可は、列のあるレイアウトでは薬品の行に添える印、無いレイアウトでは行の末尾に書く。
    def rp_lines(columns:)
      @rps.flat_map do |rp|
        lines = [["Rp#{rp.rp_number}", nil]]
        rp.medicines.each do |medicine|
          amount = medicine.dose_text.presence || "#{medicine.dose}#{medicine.unit}"
          dose = medicine.dose.present? ? " #{amount}#{'(力価)' if medicine.potency}" : ""
          uneven = medicine.uneven.present? ? "（#{medicine.uneven}）" : ""
          comment = medicine.comment.present? ? "（#{medicine.comment}）" : ""
          block = medicine.substitution_block
          label = !columns && block ? SUBSTITUTION_LABELS[block] : ""
          lines << ["　#{medicine.name}#{dose}#{uneven}#{comment}#{label}", columns ? block : nil]
        end
        amount =
          if rp.dose_days.present?
            "#{rp.dose_days}日分"
          elsif rp.dose_count.present?
            "#{rp.dose_count}回分"
          else
            ""
          end
        usage = [rp.usage_name, rp.supplement, amount].compact_blank.join(" ")
        usage_comment = rp.usage_comment.present? ? "（#{rp.usage_comment}）" : ""
        lines << ["　用法: #{usage}#{usage_comment}", nil] if usage.present? || usage_comment.present?
        lines << ["　調剤指示: #{rp.dispense_instruction}", nil] if rp.dispense_instruction.present?
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
        "issue_date" => PatientMeta.format_date(PrescriptionMeta.issue_date(@order)),
        "doctor_name" => PrescriptionMeta.doctor_name(@order),
        "department_name" => PrescriptionMeta.department_name(@order),
        "rx_category" => rx_category,
        "remarks" => PrescriptionMeta.remark_lines(@order).join("\n")
      }.merge(hospital_values)
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
        "hospital_tel" => PrescriptionMeta.telecom_value(org, "phone"),
        "hospital_fax" => PrescriptionMeta.telecom_value(org, "fax")
      }.merge(PrescriptionMeta.institution_number(org).transform_keys(&:to_s))
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
