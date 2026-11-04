module Ssmix2
  module Messages
    # アレルギー情報(ADT^A60、データ種別 ADT-61)。患者の全アレルギーを IAM で列挙し、今回書いたものを
    # A(追加)/ U(更新)/ D(削除)、それ以外を X(変更なし)にする(ガイドライン 3.1.2(2): 1 患者 1 ファイル)。
    class AdtA60 < Base
      def build
        changed = written.resource || context.last_version("AllergyIntolerance", written.id)
        return nil if changed.nil?

        patient = patient_of(changed.dig("patient", "reference"))
        allergies = current_allergies(patient["id"], changed)
        msh("ADT^A60^ADT_A60")
        evn
        pid(patient)
        pv1(patient)
        allergies.each_with_index { |allergy, index| iam(allergy, index + 1, action_code(allergy)) }
        result(data_kind: "ADT-61", service_date: UNDATED, order_no: OrderNumber::NONE, process: "INS", department_code: nil)
      end

      private

      # 患者の有効なアレルギー。消したものはメッセージにだけ D で載せる。
      def current_allergies(patient_id, changed)
        found = context.search("AllergyIntolerance", { "patient" => "Patient/#{patient_id}", "_count" => 200 })
                       .reject { |a| a["id"] == changed["id"] }
                       .select { |a| Fhir.status_code(a["clinicalStatus"]).to_s.in?(["", "active"]) }
        [changed] + found.sort_by { |a| a["id"].to_s }
      end

      def action_code(allergy)
        return "X" unless allergy["id"] == written.id

        case written.method
        when "POST" then "A"
        when "DELETE" then "D"
        else "U"
        end
      end

      def iam(allergy, sequence, action)
        fields = Array.new(20, "")
        fields[0] = sequence.to_s
        fields[1] = Codes.allergen_type_cwe(Array(allergy["category"]).first)
        fields[2] = allergen_cwe(allergy)
        fields[3] = Codes.allergy_severity_cwe(allergy["criticality"])
        fields[4] = Hl7::Types.text(Array(allergy["reaction"]).first&.dig("manifestation", 0, "text"))
        fields[5] = Hl7::Types.cwe(action, { "A" => "追加", "U" => "更新", "D" => "削除", "X" => "変更なし" }[action], "HL70323")
        fields[10] = Hl7::Stamp.day(allergy["onsetDateTime"])
        fields[12] = Hl7::Stamp.day(allergy["recordedDate"])
        builder.add("IAM", *fields)
      end

      # アレルゲン。薬剤は J-FAGY の YJ から HOT9 を引き、他は J-FAGY のコードをローカルで持つ。
      def allergen_cwe(allergy)
        code = allergy["code"]
        coding = Fhir.first_coding(code)
        name = Fhir.display_of(code).to_s
        return Hl7::Types.cwe("", name, "") if coding.nil?

        value = coding["code"].to_s
        if value.start_with?(Fhir::JFAGY_YCM_PREFIX)
          hot = Codes.hot9_for_yj(value.delete_prefix(Fhir::JFAGY_YCM_PREFIX))
          return Hl7::Types.cwe(hot, name, "HOT9", alt: [value, name, "99JFAGY"]) if hot
        end
        Hl7::Types.cwe(value, name, "99JFAGY")
      end
    end
  end
end
