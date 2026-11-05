require "stringio"
require "barby/barcode/code_128"
require "barby/outputter/png_outputter"

module Reports
  # 細菌検査の検体ラベルを ThinReports レイアウトへ流し込んで PDF を生成する。
  # 1 ページ = ラベル 1 枚(容器 1 つ)。ページ数はオーダーの容器の総数。
  #
  # レイアウト側のプレースホルダー規約(docs/report-mappings/micro-label-01.md):
  #   pt_id / pt_name / pt_kana / pt_gender / pt_birthdate ... 患者(既存の予約 ID と同じ)
  #   specimen_label ... 「喀出痰 右 耳」(検体 + 採取部位)
  #   container_no ... 「容器 1/2」(オーダー通しの容器番号 / 容器の総数)
  #   specimen_detail ... 検体の容器は「吸引 塗抹/培養」(採取方法 + 項目の略称)、ボトルは項目名
  #   order_date ... 「予定 2026/11/05 10:00」(採取予定日時。未定ならオーダーの検査日)
  #   label_number ... 番号の目視文字列、barcode_img ... バーコード画像(image-block)
  #   urgent ... 至急表示(id 付きの text。通常オーダーでは hide する)
  class MicroLabelRenderer
    def initialize(layout_path:, order:, patient:, labels:)
      @layout_path = layout_path
      @order = order
      @patient = patient
      @labels = labels
    end

    def render
      text_ids, image_ids, all_ids = layout_item_ids

      report = Thinreports::Report.new(layout: @layout_path.to_s)
      @labels.each do |label|
        report.start_new_page do |page|
          page_values(label).each { |id, value| page.item(id).value(value) if text_ids.include?(id) }
          if image_ids.include?("barcode_img")
            page.item("barcode_img").src(StringIO.new(barcode_png(label.number)))
          end
          if all_ids.include?("urgent")
            urgent? ? page.item("urgent").show : page.item("urgent").hide
          end
        end
      end
      report.generate
    end

    private

    def page_values(label)
      {
        "pt_id" => PatientMeta.identifier(@patient),
        "pt_name" => PatientMeta.display_name(@patient),
        "pt_kana" => PatientMeta.display_kana(@patient),
        "pt_gender" => PatientMeta.gender_label(@patient),
        "pt_birthdate" => PatientMeta.format_date(@patient["birthDate"]),
        "specimen_label" => label.specimen,
        "container_no" => "容器 #{label.container_number}/#{label.container_total}",
        "specimen_detail" => label.detail,
        "order_date" => "予定 #{planned_label(label.planned)}",
        "label_number" => label.number.to_s
      }
    end

    # 検体の採取予定日時。時刻まで決めていなければ日付だけ(オーダーの検査日を写したもの)。
    def planned_label(planned)
      value = planned.presence || OrderDates.order_day(@order)
      date = PatientMeta.format_date(value[0, 10])
      value.length > 10 ? "#{date} #{value[11, 5]}" : date
    end

    def urgent?
      @order["priority"] == "urgent"
    end

    # CODE128(サブセット B)の PNG。検体検査のラベルと同じ作り。
    def barcode_png(number)
      Barby::Code128B.new(number).to_png(xdim: 2, height: 60, margin: 0)
    end

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
