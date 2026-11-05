module Ssmix2
  module Messages
    # 食事オーダー(OMD^O03、データ種別 OMD)。ヘッダーの ServiceRequest 1 本から組む(食事は明細を持たない)。
    # 食種は ODS-1 T、主食は食事ごとに ODS-1 D(ODS-2 に時間帯)、欠食は時間帯付きの食止め、
    # 副食形態・塩分制限は食種の ODS-4 テキスト指示、コメントは NTE。食物アレルギーは AL1。
    class OmdO03 < Base
      DATA_KIND = "OMD".freeze

      def build
        header = written.resource || context.last_version("ServiceRequest", written.id)
        return nil if header.nil? || Fhir.order_type(header) != "meal"

        patient = patient_of(header.dig("subject", "reference"))
        deleted = written.method == "DELETE" || cancelled?(header)
        order_no = OrderNumber.for("ServiceRequest/#{header['id']}")
        department = department_code_of(Fhir.department_reference(header))
        allergies = Array(header["supportingInfo"]).map { |r| r["reference"] }.select { |r| r.to_s.start_with?("AllergyIntolerance/") }

        msh("OMD^O03^OMD_O03")
        pid(patient)
        pv1(patient, encounter: encounter_for(header, true), department_code: department)
        al1(allergies)
        orc(deleted ? "CA" : "NW", order_no, header, inpatient: true)
        tq1(3 => Hl7::Types.cwe_sub("TID", "１日３回", "HL70335"),
            7 => meal_point(header["occurrenceDateTime"]),
            8 => meal_point(Fhir.extension(header, Fhir::MEAL_ORDER_END_EXT_URL)&.dig("valueDateTime")),
            9 => Hl7::Types.cwe("R", "ルーチン", "HL70485"))
        ods_diet(header)
        ods_skipped(header)
        ods_staples(header)
        Array(header["note"]).each_with_index { |note, i| builder.add("NTE", (i + 1).to_s, "", Hl7::Types.text(note["text"])) }
        result(data_kind: DATA_KIND, service_date: Hl7::Stamp.day(header["authoredOn"]), order_no: order_no,
               process: deleted ? "DEL" : "INS", department_code: department)
      end

      private

      # TQ1-7 / TQ1-8。YYYYMMDDHH(08 朝食・12 昼食・18 夕食)。
      def meal_point(value)
        time = Hl7::Stamp.coerce(value)
        return "" if time.nil?
        return Hl7::Stamp.day(time) if time.is_a?(Date)

        time.strftime("%Y%m%d%H")
      end

      # 食種。食止めの食種は TF 定義表の NPO にローカルを併記する。
      def ods_diet(header)
        coding = Fhir.coding(header["code"], Fhir::MEAL_TYPE_SYSTEM)
        return if coding.nil?

        local = [coding["code"], coding["display"] || Fhir.display_of(header["code"]), "99ZMD"]
        diet = Master::MealDiet.find_by(item_code: coding["code"])
        cwe = diet&.is_fasting ? Hl7::Types.cwe(*Codes::MEAL_FASTING_CWE, alt: local) : Hl7::Types.cwe(*local)
        builder.add("ODS", "T", "", cwe, diet_instructions(header))
      end

      # ODS-4。副食形態と塩分制限。
      def diet_instructions(header)
        texts = []
        form = Array(header["orderDetail"]).filter_map { |d| Fhir.coding(d, Fhir::MEAL_SIDE_DISH_FORM_SYSTEM) }.first
        texts << "副食形態 #{form['display'] || form['code']}" if form
        salt = Fhir.extension(header, Fhir::MEAL_SALT_LIMIT_EXT_URL)&.dig("valueQuantity", "value")
        texts << "塩分 #{number(salt)}g" if salt
        Hl7::Types.repeats(*texts.map { |t| Hl7::Types.text(t) })
      end

      # 欠食。時間帯を指定した食止め(その食事だけ出さない)。
      def ods_skipped(header)
        Array(header["extension"]).select { |e| e["url"] == Fhir::MEAL_SKIPPED_TIMING_EXT_URL }.each do |e|
          builder.add("ODS", "T", Codes.meal_timing_cwe(e["valueCode"]), Hl7::Types.cwe(*Codes::MEAL_FASTING_CWE))
        end
      end

      # 主食。食事ごとの指定は ODS-2 に時間帯、全食共通は ODS-2 を空にする。
      def ods_staples(header)
        Array(header["orderDetail"]).each do |detail|
          coding = Fhir.coding(detail, Fhir::MEAL_STAPLE_FOOD_SYSTEM)
          next if coding.nil?

          timing = Fhir.extension(detail, Fhir::MEAL_TIMING_EXT_URL)&.dig("valueCode")
          builder.add("ODS", "D", Codes.meal_timing_cwe(timing), Hl7::Types.cwe(coding["code"], coding["display"] || detail["text"], "99ZMS"))
        end
      end
    end
  end
end
