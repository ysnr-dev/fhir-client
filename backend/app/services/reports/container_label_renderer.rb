require "stringio"
require "barby/barcode/code_128"
require "barby/outputter/png_outputter"

module Reports
  # 容器 1 つ = ラベル 1 枚(1 ページ)の検体ラベル(細菌・病理)を ThinReports レイアウトへ
  # 流し込んで PDF を生成する共通部。ページ数はオーダーの容器の総数。部門ごとの違いは
  # 検体の表示(specimen_label)と日付の表示(date_label)だけなので、サブクラスがその 2 つを組む。
  #
  # レイアウト側のプレースホルダー規約(両部門で共通。部門ごとの文言はサブクラスに):
  #   pt_id / pt_name / pt_kana / pt_gender / pt_birthdate ... 患者(既存の予約 ID と同じ)
  #   specimen_label ... 検体(サブクラス)
  #   container_no ... 「容器 1/2」(オーダー通しの容器番号 / 容器の総数)
  #   specimen_detail ... 容器の中身(label.detail)
  #   order_date ... 採取日または予定日(サブクラス)
  #   label_number ... 番号の目視文字列、barcode_img ... バーコード画像(image-block)
  #   urgent ... 至急表示(id 付きの text。通常オーダーでは hide する)
  class ContainerLabelRenderer
    def initialize(layout_path:, order:, patient:, labels:)
      @layout_path = layout_path
      @order = order
      @patient = patient
      @labels = labels
    end

    def render
      text_ids, image_ids, all_ids = ReportText.layout_item_ids(@layout_path)

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
        "specimen_label" => specimen_label(label),
        "container_no" => "容器 #{label.container_number}/#{label.container_total}",
        "specimen_detail" => label.detail,
        "order_date" => date_label(label),
        "label_number" => label.number.to_s
      }
    end

    def specimen_label(_label)
      raise NotImplementedError
    end

    def date_label(_label)
      raise NotImplementedError
    end

    def urgent?
      @order["priority"] == "urgent"
    end

    # CODE128(サブセット B)の PNG。検体検査のラベルと同じ作り。
    def barcode_png(number)
      Barby::Code128B.new(number).to_png(xdim: 2, height: 60, margin: 0)
    end
  end
end
