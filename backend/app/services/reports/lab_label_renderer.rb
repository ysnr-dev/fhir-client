require "stringio"
require "barby/barcode/code_128"
require "barby/outputter/png_outputter"

module Reports
  # 検体ラベルを ThinReports レイアウトへ流し込んで PDF を生成する。
  # 1 ページ = ラベル 1 枚(採取管 1 本)。オーダーをまたいで 1 つの PDF に並べられる。
  #
  # レイアウト側のプレースホルダー規約(docs/report-mappings/lab-label-01.md):
  #   pt_id / pt_kana / pt_gender / pt_birthdate ... 患者(既存の予約 ID と同じ)
  #   order_date / specimen_name / container_name / items / label_number ... text-block
  #   barcode_img ... バーコード画像(image-block)
  #   urgent ... 至急表示(id 付きの text。通常オーダーでは hide する)
  # レイアウトに存在しないプレースホルダーは黙って捨てる(既存レンダラと同じ)。
  class LabLabelRenderer
    # layout_path: 同梱の .tlf のパス、
    # labels: { order: Hash, patient: Hash, group: LabLabelReport::LabelGroup, number: String } の
    # 配列(order / patient はパース済み FHIR リソース)
    def initialize(layout_path:, labels:)
      @layout_path = layout_path
      @labels = labels
      @containers = {}
    end

    def render
      text_ids, image_ids, all_ids = ReportText.layout_item_ids(@layout_path)

      report = Thinreports::Report.new(layout: @layout_path.to_s)
      @labels.each do |label|
        report.start_new_page do |page|
          page_values(label).each { |id, value| page.item(id).value(value) if text_ids.include?(id) }
          if image_ids.include?("barcode_img")
            page.item("barcode_img").src(StringIO.new(barcode_png(label[:number])))
          end
          if all_ids.include?("urgent")
            label[:order]["priority"] == "urgent" ? page.item("urgent").show : page.item("urgent").hide
          end
        end
      end
      report.generate
    end

    private

    def page_values(label)
      group = label[:group]
      patient = label[:patient]
      {
        "pt_id" => PatientMeta.identifier(patient),
        "pt_name" => PatientMeta.display_name(patient),
        "pt_kana" => PatientMeta.display_kana(patient),
        "pt_gender" => PatientMeta.gender_label(patient),
        "pt_birthdate" => PatientMeta.format_date(patient["birthDate"]),
        # 検査日(オーダー開始日 = occurrenceDateTime)。
        "order_date" => PatientMeta.format_date(OrderDates.order_day(label[:order])),
        "specimen_name" => group.specimen_name.presence || "検体未設定",
        "container_name" => container_display(group),
        "items" => group.item_labels.join("・"),
        "label_number" => label[:number].to_s
      }
    end

    # 採取管(色)。「EDTA管（紫）」の形。色と略称はオーダーに写していないので
    # 採取管マスタから引く(マスタで色を直したら過去のオーダーのラベルも新しい色で
    # 刷られるべきなので、参照にしている)。マスタに無い管はオーダーの写しの名称のみ。
    def container_display(group)
      master = container_master(group.container_code)
      name = master&.short_name.presence || master&.name.presence || group.container_name
      color = master&.cap_color
      return "" if name.blank?

      color.present? ? "#{name}（#{color}）" : name
    end

    def container_master(code)
      return nil if code.blank?

      @containers.fetch(code) { @containers[code] = Master::LabContainer.find_by(container_code: code) }
    end

    # CODE128(サブセット B)の PNG。ラベル幅に収まるよう余白なしで作り、
    # 実寸はレイアウトの image-block に合わせて縮尺される。
    def barcode_png(number)
      Barby::Code128B.new(number).to_png(xdim: 2, height: 60, margin: 0)
    end
  end
end
