module Ssmix2
  module Messages
    # 放射線(OMG-11)・内視鏡(OMG-12)の実施通知(OMI^Z23)。実施記録のハブ Procedure(category が放射線・内視鏡で
    # basedOn がオーダーヘッダー)から組む。オーダーと同じ親子レコードに、OBR-7 実施日時・OBR-25 結果状態、
    # 子ごとの ZE1(手技。最初の子に実施した手技・使用物品・被曝線量も付ける)、IPC(受付番号・モダリティ)を足す。
    # ファイルのオーダ No はオーダーの番号(実施はオーダーに 1 件)、ORC-3 / OBR-3 に実施の番号を書く。
    class OmiZ23 < Base
      include ExamOrderSegments

      def build
        hub = written.resource || context.last_version("Procedure", written.id)
        return nil if hub.nil? || hub["partOf"].present?

        spec = KINDS[Fhir.category_code(hub, Fhir::ORDER_TYPE_SYSTEM)]
        return nil if spec.nil? || spec[:perform_kind].nil?

        header_reference = Fhir.reference_of_type(hub["basedOn"], "ServiceRequest")
        header = header_reference && context.by_reference(header_reference)
        return nil if header.nil?

        patient = patient_of(hub.dig("subject", "reference") || header.dig("subject", "reference"))
        leaves = exam_items(header, spec)
        deleted = written.method == "DELETE" || cancelled?(hub) || hub["status"] == "not-done"
        order_no = OrderNumber.for("ServiceRequest/#{header['id']}")
        perform_no = OrderNumber.for("Procedure/#{hub['id']}")
        inpatient = inpatient_setting?(header, Fhir::PRESCRIPTION_SETTING_SYSTEM)
        department = department_code_of(Fhir.department_reference(header))
        performed_start, performed_end = performed_range(hub)
        parent_code = parent_code_cwe(spec, leaves)
        orc_extra = { 3 => Hl7::Types.ei(perform_no), 5 => "CM", 9 => Hl7::Stamp.format(transaction.occurred_at) }
        obr_extra = { 3 => Hl7::Types.ei(perform_no), 7 => Hl7::Stamp.format(performed_start, precision: :minute),
                      8 => Hl7::Stamp.format(performed_end, precision: :minute), 22 => Hl7::Stamp.format(transaction.occurred_at), 25 => "F" }
        modality = Hl7::Types.cwe(modality_of(spec, leaves), "", "DCM")

        msh("OMI^Z23^OMI_Z23")
        pid(patient)
        pv1(patient, encounter: encounter_for(hub, inpatient), department_code: department)
        orc(deleted ? "CA" : "NW", order_no, header, inpatient: inpatient, extra: orc_extra)
        exam_tq1(header)
        exam_obr(order_no, parent_code, header, extra: obr_extra)
        ipc(perform_no, modality)
        unless deleted
          orc("PA", order_no, header, inpatient: inpatient, extra: orc_extra)
          exam_tq1(header)
          exam_obr(order_no, parent_code, header, extra: obr_extra)
          ipc(perform_no, modality)
          leaves.each_with_index do |item, index|
            child_no = child_order_no(item)
            orc("CH", child_no, header, inpatient: inpatient, extra: orc_extra.merge(8 => Hl7::Types.ei(order_no)))
            exam_tq1(header)
            exam_obr(child_no, item_code_cwe(spec, item), header, parent_no: order_no, extra: obr_extra)
            ze1(1, item_code_cwe(spec, item), hub, index.zero? ? used_items(hub, spec) : [])
            performed_segments(hub, spec) if index.zero?
            ipc(perform_no, modality)
          end
        end
        result(data_kind: spec[:perform_kind], service_date: Hl7::Stamp.day(performed_start), order_no: order_no,
               process: deleted ? "DEL" : "INS", department_code: department)
      end

      private

      def performed_range(hub)
        period = hub["performedPeriod"]
        return [period["start"], period["end"]] if period

        [hub["performedDateTime"] || transaction.occurred_at, nil]
      end

      # IPC-5。放射線は明細の JJ1017 のモダリティから DICOM のモダリティへ、内視鏡は ES。
      def modality_of(spec, leaves)
        return Codes::ENDOSCOPY_DICOM_MODALITY if spec[:order_kind] == "OMG-02"

        code = Fhir.category_coding(leaves.first, Fhir::JJ1017_MODALITY_SYSTEM)&.dig("code")
        Codes.dicom_modality(code)
      end

      # ZE1。実施区分 RS、手技、実施者、使用物品。
      def ze1(sequence, procedure_cwe, performer_source, used)
        fields = Array.new(12, "")
        fields[0] = sequence.to_s
        fields[1] = "RS"
        fields[2] = procedure_cwe
        fields[6] = performer_xcn(performer_source)
        fields[8] = Hl7::Types.repeats(*used)
        builder.add("ZE1", *fields)
      end

      # ハブと子の Procedure が持つ実施した手技(レセ電算の診療行為コード)と、被曝線量の OBX。
      def performed_segments(hub, spec)
        procedures = [hub] + part_of_resources("Procedure", "Procedure/#{hub['id']}")
        codes = procedures.filter_map { |p| Fhir.coding(p["code"], spec[:procedure_system]) }
        codes.each_with_index do |coding, index|
          ze1(index + 2, Hl7::Types.cwe(coding["code"], coding["display"], spec[:procedure_local]), hub, [])
        end
        part_of_resources("Observation", "Procedure/#{hub['id']}").each_with_index do |observation, index|
          coding = Fhir.coding(observation["code"], Fhir::RAD_DOSE_SYSTEM) || Fhir.first_coding(observation["code"])
          quantity = observation["valueQuantity"] || {}
          builder.add("OBX", (index + 1).to_s, "NM", Hl7::Types.cwe(coding&.dig("code"), coding&.dig("display") || Fhir.display_of(observation["code"]), "99ZRD"),
                      "", number(quantity["value"]), Hl7::Types.cwe(quantity["code"] || quantity["unit"], quantity["unit"], "ISO+"), "", "", "", "", "F")
        end
      end

      # ZE1-9 使用物品(ZRD)。造影剤など薬剤は HOT9 と数量・単位、器材はローカルコードと数量。
      def used_items(hub, spec)
        drugs = part_of_resources("MedicationAdministration", "Procedure/#{hub['id']}").map do |ma|
          dose = ma.dig("dosage", "dose") || {}
          unit = Codes.unit_cwe(dose["unit"]).tr("^", "&")
          Hl7::Types.components(medication_code_components(ma), number(dose["value"]), unit)
        end
        materials = Array(hub["usedCode"]).map do |used|
          coding = Fhir.coding(used, Fhir::RAD_MATERIAL_SYSTEM) || Fhir.coding(used, Fhir::MEDICAL_MATERIAL_SYSTEM) || Fhir.first_coding(used)
          quantity = Fhir::MATERIAL_QUANTITY_EXT_URLS.filter_map { |url| Fhir.extension(used, url)&.dig("valueQuantity") }.first || {}
          Hl7::Types.components(Hl7::Types.text(coding&.dig("code")), Hl7::Types.text(coding&.dig("display") || used["text"]), spec[:local].sub("I", "M"),
                                number(quantity["value"]), quantity["unit"].present? ? Hl7::Types.subcomponents(Hl7::Types.text(quantity["unit"]), Hl7::Types.text(quantity["unit"]), Codes::LOCAL_UNIT_SYSTEM) : "")
        end
        drugs + materials
      end

      # 薬剤の識別子^名称^コード体系(HOT9 が引ければ HOT9、無ければレセ電コード)。
      def medication_code_components(ma)
        concept = ma["medicationCodeableConcept"]
        name = Fhir.display_of(concept).to_s
        receipt = Fhir.coding(concept, Fhir::MEDICINE_CODE_SYSTEM)&.dig("code")
        hot = Codes.hot9_for_receipt_code(receipt)
        return Hl7::Types.cwe(hot, name, "HOT9") if hot

        warn("HOT コードが引けない薬剤があります: #{name}") if receipt
        Hl7::Types.cwe(receipt, name, "99ZRC")
      end

      # IPC。受付番号は実施の番号、検査インスタンス UID は持たないので空、モダリティは DICOM。
      def ipc(accession, modality)
        builder.add("IPC", Hl7::Types.ei(accession), "", '""', "", modality)
      end
    end
  end
end
