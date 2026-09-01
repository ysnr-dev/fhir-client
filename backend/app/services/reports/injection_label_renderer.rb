require "stringio"
require "barby/barcode/code_128"
require "barby/outputter/png_outputter"

module Reports
  # 注射ラベルを ThinReports レイアウトへ流し込んで PDF を生成する。
  # 1 ページ = ラベル 1 枚 = RP 1 つ(混注したボトル・シリンジに貼る)。
  # 検体ラベル(LabLabelRenderer)と同じ用紙・同じ患者欄で、バーコードは患者番号
  # (ラベル番号の採番は持たない。RP はオーダー内の連番なので台帳が要らない)。
  #
  # プレースホルダー規約(docs/report-mappings/injection-01.md):
  #   pt_id / pt_name / pt_kana / pt_gender / pt_birthdate ... 患者
  #   order_date / rp_label / medicines / usage ... text-block
  #   barcode_img ... 患者番号のバーコード(image-block)
  #   urgent ... 緊急注射区分の表示(id 付きの text。通常は hide)
  class InjectionLabelRenderer
    EMERGENCY_CODE = "emergency".freeze

    def initialize(layout_path:, order:, patient:, rps:)
      @layout_path = layout_path
      @order = order
      @patient = patient
      @rps = rps
    end

    def render
      text_ids, image_ids, all_ids = ReportText.layout_item_ids(@layout_path)

      report = Thinreports::Report.new(layout: @layout_path.to_s)
      @rps.each do |rp|
        report.start_new_page do |page|
          page_values(rp).each { |id, value| page.item(id).value(value) if text_ids.include?(id) }
          if image_ids.include?("barcode_img") && barcode_value.present?
            page.item("barcode_img").src(StringIO.new(barcode_png(barcode_value)))
          end
          if all_ids.include?("urgent")
            urgent? ? page.item("urgent").show : page.item("urgent").hide
          end
        end
      end
      report.generate
    end

    private

    def page_values(rp)
      {
        "pt_id" => PatientMeta.identifier(@patient),
        "pt_name" => PatientMeta.display_name(@patient),
        "pt_kana" => PatientMeta.display_kana(@patient),
        "pt_gender" => PatientMeta.gender_label(@patient),
        "pt_birthdate" => PatientMeta.format_date(@patient["birthDate"]),
        # 注射日(オーダー開始日 = occurrenceDateTime)。
        "order_date" => PatientMeta.format_date(OrderDates.order_day(@order)),
        "rp_label" => rp_label(rp),
        "medicines" => rp.medicines.map { |m| medicine_line(m) }.join("\n"),
        "usage" => InjectionMeta.usage_summary(rp)
      }
    end

    # 「RP1 / 2　10:00、20:30」。RP の総数を出すのは、貼り忘れに気付けるようにするため。
    def rp_label(rp)
      times = rp.start_times.any? ? "　#{rp.start_times.join('、')}" : ""
      "RP#{rp.rp_number} / #{@rps.size}#{times}"
    end

    def medicine_line(medicine)
      dose = medicine.dose.present? ? " #{medicine.dose}#{medicine.unit}" : ""
      "#{medicine.name}#{dose}"
    end

    # 緊急(注射区分)は取り違えの余地なく急ぐものとして目立たせる。
    def urgent?
      Array(@order["category"]).any? do |category|
        Array(category["coding"]).any? do |coding|
          coding["system"] == InjectionReport::INJECTION_CATEGORY_SYSTEM && coding["code"] == EMERGENCY_CODE
        end
      end
    end

    # 患者番号。CODE128 は ASCII のみなので、それ以外の文字を含む番号は刷らない。
    def barcode_value
      value = PatientMeta.identifier(@patient).to_s
      value.ascii_only? ? value : ""
    end

    def barcode_png(value)
      Barby::Code128B.new(value).to_png(xdim: 2, height: 60, margin: 0)
    end
  end
end
