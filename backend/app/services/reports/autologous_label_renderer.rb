require "stringio"
require "barby/barcode/code_128"
require "barby/outputter/png_outputter"

module Reports
  # 自己血の採血ラベルを ThinReports レイアウトへ流し込んで PDF を生成する(1 枚)。
  #
  # レイアウト側のプレースホルダー規約:
  #   pt_id / pt_name / pt_kana / pt_gender / pt_birthdate ... 患者(検体ラベルと同じ)
  #   blood_type ... 「A型 RhD＋」(採血した血の型。確定していなければ「型未確定」)
  #   product_line ... 「自己血(貯血式) 400mL」
  #   collected_line ... 「採血 2026/11/01 10:00」
  #   dates_line ... 「使用予定 2026/11/10　有効期限 2026/12/06」
  #   label_number ... 製剤番号の目視文字列、barcode_img ... バーコード画像(image-block)
  class AutologousLabelRenderer
    RHD_LABELS = { "positive" => "＋", "negative" => "－" }.freeze

    def initialize(layout_path:, hub:, patient:, order:, unit:)
      @layout_path = layout_path
      @hub = hub
      @patient = patient
      @order = order
      @unit = unit
    end

    def render
      text_ids, image_ids, = ReportText.layout_item_ids(@layout_path)
      report = Thinreports::Report.new(layout: @layout_path.to_s)
      report.start_new_page do |page|
        page_values.each { |id, value| page.item(id).value(value) if text_ids.include?(id) }
        if image_ids.include?("barcode_img") && number.present?
          page.item("barcode_img").src(StringIO.new(barcode_png(number)))
        end
      end
      report.generate
    end

    private

    def page_values
      {
        "pt_id" => PatientMeta.identifier(@patient),
        "pt_name" => PatientMeta.display_name(@patient),
        "pt_kana" => PatientMeta.display_kana(@patient),
        "pt_gender" => PatientMeta.gender_label(@patient),
        "pt_birthdate" => PatientMeta.format_date(@patient["birthDate"]),
        "blood_type" => blood_type.presence || "型未確定",
        "product_line" => [product_name, volume].compact_blank.join(" "),
        "collected_line" => "採血 #{format_datetime(@hub['performedDateTime'])}",
        "dates_line" => "使用予定 #{PatientMeta.format_date(OrderDates.order_day(@order).presence) if @order}" \
                        "　有効期限 #{PatientMeta.format_date(expiry).presence || '-'}",
        "label_number" => number
      }
    end

    def number
      Array(@unit["identifier"]).find { |i| i["system"] == AutologousLabelReport::PRODUCT_NUMBER_SYSTEM }&.dig("value").to_s
    end

    def product_name
      @unit.dig("medicationCodeableConcept", "coding", 0, "display").presence ||
        @unit.dig("medicationCodeableConcept", "text").to_s
    end

    def volume
      value = @unit.dig("quantity", "value")
      value.nil? ? nil : "#{value}#{@unit.dig('quantity', 'unit')}"
    end

    def expiry
      Array(@unit["extension"]).find { |e| e["url"] == AutologousLabelReport::EXPIRY_EXT_URL }&.dig("valueDate").to_s
    end

    def blood_type
      abo = extension_code(AutologousLabelReport::ABO_EXT_URL)
      rhd = extension_code(AutologousLabelReport::RHD_EXT_URL)
      [abo.present? ? "#{abo}型" : nil, rhd.present? ? "RhD#{RHD_LABELS.fetch(rhd, rhd)}" : nil].compact.join(" ")
    end

    def extension_code(url)
      Array(@unit["extension"]).find { |e| e["url"] == url }&.dig("valueCodeableConcept", "coding", 0, "code").to_s
    end

    def format_datetime(value)
      return "" if value.blank?

      Time.zone.parse(value).in_time_zone(FacilityClock::ZONE).strftime("%Y/%m/%d %H:%M")
    rescue ArgumentError
      value.to_s
    end

    def barcode_png(value)
      Barby::Code128B.new(value).to_png(xdim: 2, height: 60, margin: 0)
    end
  end
end
