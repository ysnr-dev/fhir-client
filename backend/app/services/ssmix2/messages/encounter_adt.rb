module Ssmix2
  module Messages
    # 入院(Encounter、class=IMP)の書き込みから、入院実施(ADT^A01)・退院実施(ADT^A03)・転科転棟(ADT^A02)・
    # 入院取消(ADT^A11)・退院取消(ADT^A13)のどれかを起こす。どの事象かは前の版との比較で決める。
    # 予定(入院予定・退院予定・転科転棟予定)は EncounterPlanAdt、担当医の変更は EncounterAttendingAdt。
    class EncounterAdt < Base
      Event = Struct.new(:code, :structure, :data_kind, :process, :service_date, :occurred, :order_ref, keyword_init: true)

      def build
        encounter = written.resource
        return nil if encounter.nil? || encounter.dig("class", "code") != "IMP"

        event = classify(encounter, previous_version("Encounter", encounter))
        return nil if event.nil?

        patient = patient_of(encounter.dig("subject", "reference"))
        msh("ADT^#{event.code}^#{event.structure}")
        evn(occurred: event.occurred)
        pid(patient)
        pv1(patient, encounter: encounter, extra: pv1_extra(event, encounter))
        result(data_kind: event.data_kind, service_date: event.service_date, order_no: OrderNumber.for(event.order_ref),
               process: event.process, department_code: department_code_of(encounter.dig("serviceProvider", "reference")))
      end

      private

      def classify(encounter, previous)
        status = encounter["status"]
        ref = "Encounter/#{encounter['id']}"
        start = Hl7::Stamp.day(encounter.dig("period", "start"))
        case status
        when "entered-in-error"
          # 入院予定の誤登録は予定の取消(EncounterPlanAdt)。
          return nil if previous.nil? || %w[entered-in-error planned cancelled].include?(previous["status"])

          event("A11", "ADT_A09", "ADT-22", "DEL", start, nil, "#{ref}#A01")
        when "finished"
          return nil if previous && previous["status"] == "finished"

          event("A03", "ADT_A03", "ADT-52", "INS", Hl7::Stamp.day(encounter.dig("period", "end")), nil, "#{ref}#A03")
        when "in-progress"
          if previous.nil? || previous["status"] == "planned"
            event("A01", "ADT_A01", "ADT-22", "INS", start, nil, "#{ref}#A01")
          elsif previous["status"] == "finished"
            event("A13", "ADT_A01", "ADT-52", "DEL", Hl7::Stamp.day(previous.dig("period", "end")), nil, "#{ref}#A03")
          elsif transferred?(encounter, previous)
            moved_at = Array(encounter["location"]).first&.dig("period", "start") || transaction.occurred_at
            event("A02", "ADT_A02", "ADT-42", "INS", Hl7::Stamp.day(moved_at), moved_at,
                  "#{ref}#A02@#{Hl7::Stamp.format(transaction.occurred_at, precision: :millisecond)}")
          end
        end
      end

      def event(code, structure, data_kind, process, service_date, occurred, order_ref)
        Event.new(code: code, structure: structure, data_kind: data_kind, process: process,
                  service_date: service_date.presence || UNDATED, occurred: occurred, order_ref: order_ref)
      end

      # 転室・転床は location が増える。転科は serviceProvider が変わる。
      def transferred?(encounter, previous)
        Array(encounter["location"]).size > Array(previous["location"]).size ||
          encounter.dig("serviceProvider", "reference") != previous.dig("serviceProvider", "reference")
      end

      # PV1-6 以前の所在(転棟のとき)、PV1-10 診療部門(入院・転棟のとき)、PV1-17 入院時医師。
      def pv1_extra(event, encounter)
        extra = {}
        if event.code == "A02"
          previous_bed = Array(encounter["location"])[1]&.dig("location", "reference")
          if previous_bed
            chain = context.location_chain(previous_bed)
            extra[6] = Hl7::Types.pl_inpatient(location_code(chain["wa"]), location_code(chain["ro"]), location_code(chain["bd"]))
          end
        end
        if %w[A01 A02].include?(event.code)
          code = Fhir.department_code(context.by_reference(encounter.dig("serviceProvider", "reference")))
          extra[10] = code if code
        end
        attending = Fhir.participant_reference(encounter, "ATND")
        extra[17] = practitioner_xcn(attending) if event.code == "A01" && attending
        extra
      end
    end
  end
end
