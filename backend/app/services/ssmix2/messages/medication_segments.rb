module Ssmix2
  module Messages
    # 処方・注射のオーダー部分(ORC / RXE / TQ1 / RXR / RXC)の組み立て。オーダー(RDE^O11)と実施(RAS^O17)で
    # 同じセグメントを使うので、Base の子クラスに include して共有する。
    module MedicationSegments
      private

      # 明細。同じ transaction で書かれたものを優先し、無ければ上流から引く。
      def medication_requests(header)
        reference = "ServiceRequest/#{header['id']}"
        written_in_transaction = Dispatcher.written_resources(transaction).filter_map do |w|
          next unless w.type == "MedicationRequest" && w.method != "DELETE" && w.resource

          w.resource if Array(w.resource["basedOn"]).any? { |b| b["reference"] == reference }
        end
        return written_in_transaction if written_in_transaction.any? && written.type == "ServiceRequest" && written.method == "POST"

        found = context.search("MedicationRequest", { "based-on" => reference, "_count" => 200 })
        by_id = found.index_by { |mr| mr["id"] }
        written_in_transaction.each { |mr| by_id[mr["id"]] = mr }
        by_id.values
      end

      def rp_number(mr) = Fhir.identifier_value(mr, Fhir::RP_NUMBER_SYSTEM).to_i

      def order_in_rp(mr) = Fhir.identifier_value(mr, Fhir::ORDER_IN_RP_SYSTEM).to_i

      # 取り消した薬剤行は外す。オーダーごと取り消したときは取消の相手になる行なので残す。
      def prescription_groups(header, requests)
        keep_cancelled = written.method == "DELETE" || cancelled?(header)
        requests.reject { |mr| cancelled?(mr) && !keep_cancelled }.sort_by { |mr| [rp_number(mr), order_in_rp(mr)] }
      end

      def injection_groups(requests)
        requests.sort_by { |mr| [rp_number(mr), order_in_rp(mr)] }.group_by { |mr| rp_number(mr) }
      end

      # 処方 1 剤の ORC / RXE / TQ1 / RXR。orc_extra は ORC に足すフィールド(実施では ORC-3 / ORC-9)。
      def prescription_order(header, mr, order_control, order_no, inpatient, orc_extra: {})
        dosage = Array(mr["dosageInstruction"]).first || {}
        orc(order_control, order_no, header, inpatient: inpatient, extra: { 4 => rp_number(mr).to_s }.merge(orc_extra))
        rxe_prescription(header, mr, dosage)
        tq1_prescription(header, mr, dosage)
        rxr_prescription(dosage)
      end

      def rxr_prescription(dosage)
        usage = Fhir.coding(dosage.dig("timing", "code"), Fhir::USAGE_CODE_SYSTEM)
        builder.add("RXR", Codes.usage_route_cwe(usage&.dig("code")))
      end

      def rxe_prescription(header, mr, dosage)
        dose_and_rate = Array(dosage["doseAndRate"]).first || {}
        single = dose_and_rate.dig("doseQuantity", "value")
        daily = dose_and_rate.dig("rateRatio", "numerator", "value")
        unit = dose_and_rate.dig("doseQuantity", "unit") || dose_and_rate.dig("rateRatio", "numerator", "unit")
        days = mr.dig("dispenseRequest", "expectedSupplyDuration", "value")
        amount = single || daily
        total = daily && days ? daily * days : amount
        fields = Array.new(44, "")
        fields[1] = medication_cwe(mr)
        fields[2] = number(amount)
        fields[4] = Codes.unit_cwe(unit)
        fields[6] = Hl7::Types.repeats(*Array(dosage["additionalInstruction"]).map { |i| Fhir.display_of(i) }.compact
                                          .map { |t| Hl7::Types.cwe("", t, "99ZCM") })
        fields[9] = number(total)
        fields[10] = Codes.unit_cwe(unit)
        fields[14] = Hl7::Types.text(header["id"])
        fields[20] = Codes.prescription_category_cwe(Fhir.category_code(header, Fhir::PRESCRIPTION_SETTING_SYSTEM),
                                                    Fhir.category_code(header, Fhir::PRESCRIPTION_CATEGORY_SYSTEM))
        fields[30] = supplemental_code_cwe(mr)
        builder.add("RXE", *fields)
      end

      def tq1_prescription(header, mr, dosage)
        usage = Fhir.coding(dosage.dig("timing", "code"), Fhir::USAGE_CODE_SYSTEM)
        days = mr.dig("dispenseRequest", "expectedSupplyDuration", "value")
        start = Hl7::Stamp.coerce(header["occurrenceDateTime"])
        finish = start && days ? start.to_date + (days.to_i - 1) : nil
        fields = Array.new(14, "")
        fields[0] = "1"
        fields[2] = usage ? Hl7::Types.cwe_sub(usage["code"], usage["display"], "JAMISDP01") : ""
        fields[5] = days ? Hl7::Types.components(number(days), "d") : ""
        fields[6] = Hl7::Stamp.day(start)
        fields[7] = Hl7::Stamp.day(finish)
        fields[10] = Hl7::Types.text(dosage["text"])
        fields[13] = dosage.dig("timing", "repeat", "count").to_s
        builder.add("TQ1", *fields)
      end

      # 注射 1 RP の ORC / RXE / TQ1 / RXR / RXC。
      def injection_order(header, rp, mrs, order_control, order_no, inpatient, orc_extra: {})
        first = mrs.first
        dosage = Array(first["dosageInstruction"]).first || {}
        orc(order_control, order_no, header, inpatient: inpatient, extra: { 4 => "#{order_no}_#{format('%02d', rp)}" }.merge(orc_extra))
        rxe_injection(header, mrs, dosage)
        tq1_injection(dosage)
        rxr_injection(dosage)
        mrs.each_with_index { |mr, index| rxc(mr, index.zero? ? "B" : "A") }
      end

      def rxe_injection(header, mrs, dosage)
        volumes = mrs.map { |mr| Array(mr["dosageInstruction"]).first&.dig("doseAndRate", 0, "doseQuantity") }
                     .select { |q| q && q["unit"].to_s.downcase.in?(%w[ml mL ｍｌ]) }.map { |q| q["value"].to_f }
        rate = dosage.dig("doseAndRate", 0, "rateQuantity")
        fields = Array.new(44, "")
        fields[1] = Hl7::Types.cwe("00", "一般", "99I02")
        fields[2] = volumes.any? ? number(volumes.sum) : ""
        fields[4] = volumes.any? ? Hl7::Types.cwe("ML", "ミリリットル", "MR9P") : ""
        fields[5] = Hl7::Types.cwe("INJ", "注射剤", "MR9P")
        fields[6] = Hl7::Types.repeats(*Array(dosage["additionalInstruction"]).map { |i| Fhir.display_of(i) }.compact
                                          .map { |t| Hl7::Types.cwe("", t, "99IC6") })
        fields[14] = Hl7::Types.text(header["id"])
        category = Fhir.category_coding(header, Fhir::INJECTION_CATEGORY_SYSTEM)
        fields[20] = Codes.injection_category_cwe(Fhir.category_code(header, Fhir::PRESCRIPTION_SETTING_SYSTEM),
                                                  category&.dig("code"), category&.dig("display"))
        if rate
          fields[21] = "H1"
          fields[22] = number(rate["value"])
          fields[23] = Hl7::Types.cwe("ml/hr", "ミリリッター／時間", "ISO+")
        end
        builder.add("RXE", *fields)
      end

      def tq1_injection(dosage)
        start = Array(dosage.dig("timing", "event")).first
        period = Fhir.extension(dosage, Fhir::SCHEDULED_PERIOD_EXT_URL)
        finish = Array(period&.dig("extension")).find { |e| e["url"] == "end" }&.dig("valueDateTime")
        fields = Array.new(8, "")
        fields[0] = "1"
        fields[6] = Hl7::Stamp.format(start, precision: :minute)
        fields[7] = Hl7::Stamp.format(finish, precision: :minute)
        builder.add("TQ1", *fields)
      end

      def rxr_injection(dosage)
        route = Fhir.first_coding(dosage["route"])
        site = Fhir.first_coding(dosage["site"])
        method = Fhir.first_coding(dosage["method"])
        builder.add(
          "RXR",
          route ? Hl7::Types.cwe(route["code"], route["display"], "HL70162") : Codes::OTHER_ROUTE.then { |c, n| Hl7::Types.cwe(c, n, "HL70162") },
          site ? Hl7::Types.cwe(site["code"], site["display"], "JAMISDP01") : "",
          "",
          method ? Hl7::Types.cwe(method["code"], method["display"], "99ZMT") : ""
        )
      end

      def rxc(mr, component_type)
        dose = Array(mr["dosageInstruction"]).first&.dig("doseAndRate", 0, "doseQuantity") || {}
        builder.add("RXC", component_type, medication_cwe(mr), number(dose["value"]), Codes.unit_cwe(dose["unit"]))
      end

      # RXE-2 / RXC-2 / RXA-5。HOT9 が引ければ標準、無ければレセ電コードのローカル。一般名処方は一般名コード。
      # MedicationRequest と MedicationAdministration のどちらも medicationCodeableConcept を持つ。
      def medication_cwe(resource)
        concept = resource["medicationCodeableConcept"]
        name = Fhir.display_of(concept).to_s
        receipt = Fhir.coding(concept, Fhir::MEDICINE_CODE_SYSTEM)&.dig("code")
        general = Fhir.coding(concept, Fhir::GENERAL_ORDER_CODE_SYSTEM)&.dig("code")
        hot = Codes.hot9_for_receipt_code(receipt)
        return Hl7::Types.cwe(hot, name, "HOT9", alt: [receipt, name, "99ZRC"]) if hot
        return Hl7::Types.cwe(general, name, "99ZGN") if general && receipt.nil?

        warn("HOT コードが引けない薬剤があります: #{name}") if receipt
        Hl7::Types.cwe(receipt, name, "99ZRC")
      end

      # RXE-31 補足コード。HOT が無い薬剤の YJ コードを、ローカルコードと組にして書く。
      def supplemental_code_cwe(mr)
        concept = mr["medicationCodeableConcept"]
        receipt = Fhir.coding(concept, Fhir::MEDICINE_CODE_SYSTEM)&.dig("code")
        yj = Fhir.coding(concept, Fhir::YJ_CODE_SYSTEM)&.dig("code")
        return "" if receipt.blank? || yj.blank?

        Hl7::Types.cwe(receipt, "", "99ZRC", alt: [yj, "", "YJ"])
      end
    end
  end
end
