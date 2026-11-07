module Ssmix2
  module Messages
    # 処方実施(OMP-11)と注射実施(OMP-12)の通知(RAS^O17)。実施 1 回のハブ Procedure(category が処方・注射で
    # basedOn がオーダーヘッダー)と、partOf でぶら下がる薬剤ごとの MedicationAdministration から組む。
    # オーダー部分(ORC / RXE / TQ1 / RXR / RXC)は RDE^O11 と同じで、その後ろに薬剤ごとの RXA を置く。
    # 1 ファイル = 実施 1 回なので、ファイルのオーダ No は実施(Procedure)で採番し、ORC-2 はオーダーの番号、
    # ORC-3(実施者オーダ番号)に実施の番号を書く。実施の削除・誤登録は ORC-1 CA の DEL。
    class RasO17 < Base
      include MedicationSegments

      def build
        hub = written.resource || context.last_version("Procedure", written.id)
        return nil if hub.nil? || hub["partOf"].present?

        kind = Fhir.category_code(hub, Fhir::ORDER_TYPE_SYSTEM)
        return nil unless %w[prescription injection].include?(kind)

        header_reference = Fhir.reference_of_type(hub["basedOn"], "ServiceRequest")
        header = header_reference && context.by_reference(header_reference)
        return nil if header.nil?

        patient = patient_of(hub.dig("subject", "reference") || header.dig("subject", "reference"))
        administrations = administrations_of(hub)
        requests = requests_for(header, administrations)
        deleted = written.method == "DELETE" || cancelled?(hub)
        order_control = deleted ? "CA" : "NW"
        order_no = OrderNumber.for("ServiceRequest/#{header['id']}")
        perform_no = OrderNumber.for("Procedure/#{hub['id']}")
        inpatient = inpatient_setting?(header, Fhir::PRESCRIPTION_SETTING_SYSTEM)
        department = department_code_of(Fhir.department_reference(header))
        encounter = encounter_for(hub, inpatient)
        encounter = context.current_admission(patient["id"]) if encounter == :current
        orc_extra = { 3 => Hl7::Types.ei(perform_no), 9 => Hl7::Stamp.format(transaction.occurred_at) }

        msh("RAS^O17^RAS_O17")
        pid(patient)
        pv1(patient, encounter: encounter, department_code: department)
        if kind == "prescription"
          prescription_groups(header, requests).each do |mr|
            prescription_order(header, mr, order_control, order_no, inpatient, orc_extra: orc_extra)
            administration_segments(hub, administrations_for(administrations, [mr]), [mr], encounter, department)
            rxr_prescription(Array(mr["dosageInstruction"]).first || {})
          end
        else
          injection_groups(requests).each do |rp, mrs|
            injection_order(header, rp, mrs, order_control, order_no, inpatient, orc_extra: orc_extra)
            administration_segments(hub, administrations_for(administrations, mrs), mrs, encounter, department)
            rxr_injection(Array(mrs.first["dosageInstruction"]).first || {})
          end
        end
        result(data_kind: kind == "prescription" ? "OMP-11" : "OMP-12", service_date: Hl7::Stamp.day(performed_at(hub, administrations)),
               order_no: perform_no, process: deleted ? "DEL" : "INS", department_code: department)
      end

      private

      # 実施した薬剤。同じ transaction で書かれた分を上流の分(part-of で引く)に重ねる。
      def administrations_of(hub)
        part_of_resources("MedicationAdministration", "Procedure/#{hub['id']}")
      end

      # オーダーの明細のうち実施した薬剤のもの。実施が薬剤を指していなければオーダーの全明細。
      def requests_for(header, administrations)
        requests = medication_requests(header)
        administered = administrations.filter_map { |ma| Fhir.reference_id(ma.dig("request", "reference")) }
        matched = requests.select { |mr| administered.include?(mr["id"]) }
        matched.any? ? matched : requests
      end

      def administrations_for(administrations, mrs)
        ids = mrs.map { |mr| mr["id"] }
        matched = administrations.select { |ma| ids.include?(Fhir.reference_id(ma.dig("request", "reference"))) }
        matched.any? ? matched : administrations.reject { |ma| ma.dig("request", "reference").present? }
      end

      # ADMINISTRATION。薬剤ごとに RXA。実施していない(not-done)ハブは薬剤の記録を持たないので、
      # オーダーの薬剤ごとに実施量なしの RXA(完了状態 NA)にする。
      def administration_segments(hub, administrations, mrs, encounter, department)
        if administrations.empty?
          mrs.each { |mr| rxa(hub, nil, encounter, department, medication: mr) }
        else
          administrations.each { |ma| rxa(hub, ma, encounter, department, medication: ma) }
        end
      end

      def rxa(hub, administration, encounter, department, medication:)
        subject = administration || hub
        start, finish = effective_range(hub, administration)
        dose = administration&.dig("dosage", "dose") || {}
        rate = administration&.dig("dosage", "rateQuantity")
        fields = Array.new(22, "")
        fields[0] = "0"
        fields[1] = "1"
        fields[2] = Hl7::Stamp.format(start)
        fields[3] = Hl7::Stamp.format(finish || start)
        fields[4] = medication_cwe(medication)
        fields[5] = number(dose["value"])
        fields[6] = Codes.unit_cwe(dose["unit"])
        fields[8] = Hl7::Types.repeats(*Array(subject["note"]).map { |n| n["text"] }.compact.map { |t| Hl7::Types.cwe("", t, "99IC7") })
        fields[9] = performer_xcn(administration).presence || performer_xcn(hub)
        fields[10] = administration_location(encounter, department)
        fields[11] = rate ? Hl7::Types.text("#{number(rate['value'])} #{rate['unit']}".strip) : ""
        fields[14] = Hl7::Types.text(Fhir.extension(administration, Fhir::MEDICATION_LOT_NUMBER_EXT_URL)&.dig("valueString"))
        fields[17] = hub["status"] == "not-done" ? Hl7::Types.cwe("", hub.dig("statusReason", "text"), "99ZRS") : ""
        fields[19] = Codes.administration_completion(administration ? administration["status"] : hub["status"])
        fields[21] = Hl7::Stamp.format(transaction.occurred_at)
        builder.add("RXA", *fields)
      end

      # RXA-3 / RXA-4。薬剤の記録の effective、無ければハブの performed。
      def effective_range(hub, administration)
        if administration
          period = administration["effectivePeriod"]
          return [period["start"], period["end"]] if period
          return [administration["effectiveDateTime"], nil] if administration["effectiveDateTime"]
        end
        period = hub["performedPeriod"]
        return [period["start"], period["end"]] if period

        [hub["performedDateTime"] || transaction.occurred_at, nil]
      end

      def performed_at(hub, administrations)
        effective_range(hub, administrations.first).first
      end

      # RXA-11 投薬場所(LA2)。入院は病棟^病室^ベッド^^^N、外来は診療科^^^^^C。
      def administration_location(encounter, department)
        return inpatient_location(encounter) if encounter && inpatient?(encounter)

        department ? Hl7::Types.pl_outpatient(department) : ""
      end
    end
  end
end
