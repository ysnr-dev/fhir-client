module Integrations
  module Orca
    # 中立の会計明細 → 日レセの Medical_Information。
    #
    # 診療種別区分(Medical_Class)は日レセが剤をまとめる単位で、点数表の部に対応する。
    # 検体検査・生理・内視鏡・細菌・病理はすべて「検査」の 600 に入る。
    module MedicalMessage
      # 日レセの上限(reference/record/xml_medicalv2req.db)。
      MAX_CLASSES = 40
      MAX_LINES = 40

      MEDICAL_CLASS = {
        oral: "210", as_needed: "220", topical: "230",
        treatment: "400", surgery: "500",
        lab: "600", micro: "600", physio: "600", endoscopy: "600",
        rad: "700"
      }.freeze

      module_function

      # 送れない明細は捨てず、理由つきで second の配列に返す。
      def build(items)
        classes = []
        dropped = []

        items.each do |item|
          medical_class = MEDICAL_CLASS[item.category]
          if medical_class.nil?
            dropped << { kind: item.category.to_s, name: item.name,
                         reason: "日レセの診療種別区分に対応がありません" }
            next
          end

          classes << {
            "Medical_Class" => medical_class,
            "Medical_Class_Name" => item.name,
            "Medical_Class_Number" => item.days.presence || "1",
            "Medication_info" => item.lines.first(MAX_LINES).map { |line| medication(line, item) }
          }
        end

        if classes.length > MAX_CLASSES
          classes[MAX_CLASSES..].each do |entry|
            dropped << { kind: "剤", name: entry["Medical_Class_Name"],
                         reason: "1 回に送れる剤は #{MAX_CLASSES} までです" }
          end
          classes = classes.first(MAX_CLASSES)
        end

        [classes, dropped]
      end

      def medication(line, item)
        {
          "Medication_Code" => line.code,
          "Medication_Name" => line.name,
          "Medication_Usage_Code" => item.usage_code,
          "Medication_Number" => line.quantity
        }.compact_blank
      end
    end
  end
end
