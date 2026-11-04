module Ssmix2
  module Messages
    # 検体検査オーダー(OML^O33、データ種別 OML-01)。ヘッダーの ServiceRequest と明細(basedOn で指す項目・
    # パネル)から、検体ごとに SPM、その下に ORC / OBR と依頼項目の OBX(OBX-11 = O)を組む。
    class OmlO33 < Base
      def build
        header = written.resource || context.last_version("ServiceRequest", written.id)
        return nil if header.nil? || Fhir.order_type(header) != "lab"

        patient = patient_of(header.dig("subject", "reference"))
        items = item_requests(header)
        deleted = written.method == "DELETE" || cancelled?(header)
        order_no = OrderNumber.for("ServiceRequest/#{header['id']}")
        inpatient = inpatient_setting?(header, Fhir::PRESCRIPTION_SETTING_SYSTEM)
        department = department_code_of(Fhir.department_reference(header))

        msh("OML^O33^OML_O33")
        pid(patient)
        pv1(patient, encounter: inpatient ? :current : nil, department_code: department)
        specimen_groups(items).each_with_index do |(specimen, group), index|
          spm(specimen, index + 1, header)
          orc(deleted ? "CA" : "NW", order_no, header, inpatient: inpatient)
          obr(order_no, group, header, index + 1)
          leaves(group, items).each_with_index { |item, i| obx_request(item, i + 1) }
        end
        result(data_kind: "OML-01", service_date: Hl7::Stamp.day(header["authoredOn"]), order_no: order_no,
               process: deleted ? "DEL" : "INS", department_code: department)
      end

      private

      # 明細。同じ transaction で書かれた分を上流の分に重ねる(パネルの構成項目も含む)。
      def item_requests(header)
        found = context.search("ServiceRequest", { "based-on" => "ServiceRequest/#{header['id']}", "_count" => 200 })
        panels = found.select { |sr| found.none? { |o| Array(o["basedOn"]).any? { |b| b["reference"] == "ServiceRequest/#{sr['id']}" } } }
        members = found.filter_map { |sr| sr if Fhir.coding(sr["code"], Fhir::LAB_ORDER_ITEM_SYSTEM) }
        by_id = (panels + members).index_by { |sr| sr["id"] }
        Dispatcher.written_resources(transaction).each do |w|
          next unless w.type == "ServiceRequest" && w.method != "DELETE" && w.resource && w.id != header["id"]
          next unless Fhir.coding(w.resource["code"], Fhir::LAB_ORDER_ITEM_SYSTEM)

          by_id[w.id] = w.resource
        end
        by_id.values
      end

      # 検体コードごとにまとめる。検体の無い項目は空の検体として最後に置く。
      def specimen_groups(items)
        top = items.select { |sr| Array(sr["basedOn"]).any? { |b| b["reference"].to_s.start_with?("urn:uuid:") || b["reference"] == "ServiceRequest/#{written.id}" } }
        top = items if top.empty?
        top.group_by { |sr| specimen_code(sr) }.sort_by { |code, _| code.to_s.empty? ? "~" : code }
                                               .map { |code, group| [[code, group.first], group] }
      end

      def specimen_code(sr)
        contained = Array(sr["contained"]).find { |c| c["resourceType"] == "Specimen" }
        Fhir.coding(contained&.dig("type"), Fhir::JLAC11_SPECIMEN_SYSTEM)&.dig("code").to_s
      end

      def spm((code, sr), sequence, header)
        contained = Array(sr["contained"]).find { |c| c["resourceType"] == "Specimen" }
        fields = Array.new(27, "")
        fields[0] = sequence.to_s
        fields[3] = code.present? ? Hl7::Types.cwe(code, Fhir.display_of(contained&.dig("type")), "JC11") : ""
        fields[16] = Hl7::Stamp.format(header["occurrenceDateTime"])
        builder.add("SPM", *fields)
      end

      def obr(order_no, group, header, sequence)
        set = group.size == 1 ? group.first : nil
        set_coding = set && Fhir.coding(set["code"], Fhir::LAB_ORDER_ITEM_SYSTEM)
        fields = Array.new(31, "")
        fields[0] = sequence.to_s
        fields[1] = Hl7::Types.ei(order_no)
        fields[3] = set_coding ? Hl7::Types.cwe(set_coding["code"], set_coding["display"], "99O03") : Hl7::Types.cwe("", "検体検査", "99O03")
        fields[4] = header["priority"] == "urgent" ? "S" : "R"
        requester = header.dig("requester", "reference")
        fields[15] = practitioner_xcn(requester) if requester.present?
        builder.add("OBR", *fields)
      end

      # パネルの構成項目を展開した末端の項目。
      def leaves(group, items)
        group.flat_map do |sr|
          children = items.select { |c| Array(c["basedOn"]).any? { |b| b["reference"] == "ServiceRequest/#{sr['id']}" } }
          children.any? ? children : [sr]
        end
      end

      def obx_request(item, sequence)
        local = Fhir.coding(item["code"], Fhir::LAB_ORDER_ITEM_SYSTEM)
        jlac10 = Fhir.coding(item["code"], Fhir::JLAC10_SYSTEM)
        jlac11 = Fhir.coding(item["code"], Fhir::JLAC11_SYSTEM)
        short = Fhir.coding(item["code"], Fhir::ABBREVIATION_SYSTEM)&.dig("display")
        standard = jlac10 ? [jlac10["code"], jlac10["display"], "JC10"] : (jlac11 ? [jlac11["code"], jlac11["display"], "JC11"] : nil)
        name = Fhir.display_of(item["code"])
        code = if standard
                 Hl7::Types.cwe(*standard, alt: [local&.dig("code"), short || name, "99X03"])
               else
                 Hl7::Types.cwe(local&.dig("code"), short || name, "99X03")
               end
        fields = Array.new(11, "")
        fields[0] = sequence.to_s
        fields[2] = code
        fields[10] = "O"
        builder.add("OBX", *fields)
      end
    end
  end
end
