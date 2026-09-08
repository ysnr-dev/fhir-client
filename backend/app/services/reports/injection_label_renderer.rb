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
        "medicines" => medicines_block(rp),
        "usage" => InjectionMeta.usage_summary(rp),
        # 化学療法はレジメンとクールが分かると調製・監査の手順が決まる(§7.6 E-6)。
        "regimen" => regimen_line
      }
    end

    # 「RP1 / 2　10:00、20:30」。RP の総数を出すのは、貼り忘れに気付けるようにするため。
    def rp_label(rp)
      times = rp.start_times.any? ? "　#{rp.start_times.join('、')}" : ""
      "RP#{rp.rp_number} / #{@rps.size}#{times}"
    end

    # 薬剤欄(4 行)。化学療法のときだけ、最後に用法コメント(ステップ名 / 器材 /
    # 投与時注意)の行を足す —— ボトルを混ぜる人が「血管外漏出注意」に気付けるように。
    # ラベルは 60×40mm しか無いので長い注意は行末で切れる(全文は注射箋にある)。
    # 手入力の注射では足さない(4 剤の混注で薬剤名が押し出されるため)。
    def medicines_block(rp)
      lines = rp.medicines.map { |m| medicine_line(m) }
      lines << rp.usage_comment if regimen_line.present? && rp.usage_comment.present?
      lines.join("\n")
    end

    # 「mFOLFOX6 C1 Day1 ｜ 減量」。化学療法でなければ空(ラベルの行が空になるだけ)。
    def regimen_line
      label = InjectionMeta.regimen_label(@order)
      return "" if label.blank?

      InjectionMeta.regimen_reduction(@order).present? ? "#{label} ｜ 減量" : label
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
