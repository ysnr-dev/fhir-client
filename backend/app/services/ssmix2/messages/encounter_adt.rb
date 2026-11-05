module Ssmix2
  module Messages
    # 入院(Encounter、class=IMP)の書き込みから、入院実施(ADT^A01)・退院実施(ADT^A03)・転科転棟(ADT^A02)・
    # 入院取消(ADT^A11)・退院取消(ADT^A13)・転科転棟の取消(ADT^A12)のどれかを起こす。どの事象かは前の版との比較で決める。
    # 予定(入院予定・退院予定・転科転棟予定)は EncounterPlanAdt、担当医の変更は EncounterAttendingAdt。
    class EncounterAdt < Base
      Event = Struct.new(:code, :structure, :data_kind, :process, :service_date, :occurred, :order_ref, :prior_location,
                         keyword_init: true)

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
          elsif transfer_cancelled?(encounter, previous)
            cancelled = Array(previous["location"]).first
            moved_at = cancelled.dig("period", "start")
            event("A12", "ADT_A09", "ADT-42", "DEL", Hl7::Stamp.day(moved_at), moved_at,
                  move_order_ref(ref, Array(previous["location"])), prior_location: cancelled.dig("location", "reference"))
          elsif transferred?(encounter, previous)
            moved = moved?(encounter, previous)
            moved_at = (moved && Array(encounter["location"]).first.dig("period", "start")) || transaction.occurred_at
            order_ref = if moved
                          move_order_ref(ref, Array(encounter["location"]))
                        else
                          "#{ref}#A02@#{Hl7::Stamp.format(transaction.occurred_at, precision: :millisecond)}"
                        end
            event("A02", "ADT_A02", "ADT-42", "INS", Hl7::Stamp.day(moved_at), moved_at, order_ref,
                  prior_location: Array(encounter["location"])[moved ? 1 : 0]&.dig("location", "reference"))
          end
        end
      end

      def event(code, structure, data_kind, process, service_date, occurred, order_ref, prior_location: nil)
        Event.new(code: code, structure: structure, data_kind: data_kind, process: process,
                  service_date: service_date.presence || UNDATED, occurred: occurred, order_ref: order_ref,
                  prior_location: prior_location)
      end

      # 転室・転床・転棟は location の先頭に移動先が足される。転科は serviceProvider が変わる。
      def transferred?(encounter, previous)
        moved?(encounter, previous) ||
          encounter.dig("serviceProvider", "reference") != previous.dig("serviceProvider", "reference")
      end

      def moved?(encounter, previous)
        Array(encounter["location"]).size > Array(previous["location"]).size
      end

      # 移動の取消は、先頭の移動先が外れて 1 つ前の床が先頭に戻る(frontend の buildTransferCancelledEncounter)。
      def transfer_cancelled?(encounter, previous)
        now = Array(encounter["location"])
        before = Array(previous["location"])
        now.size == before.size - 1 && now.size.positive? &&
          now.first&.dig("location", "reference") == before[1]&.dig("location", "reference")
      end

      # 床を移した転科転棟の番号は、移動後の location(先頭が移動先)の件数・移動先の床・移動日から採る。
      # 取消(A12)が取り消す A02 と同じ番号を引くため。床を移さない転科は移動の記録が無いので、書き込み時刻で採る。
      def move_order_ref(ref, locations)
        entry = locations.first
        "#{ref}#A02@#{locations.size}@#{entry.dig('location', 'reference')}@#{entry.dig('period', 'start')}"
      end

      # PV1-6 以前の所在(転棟と取消のとき)、PV1-10 診療部門(入院・転棟・取消のとき)、PV1-17 入院時医師。
      def pv1_extra(event, encounter)
        extra = {}
        # 転科転棟は移動前の床、取消(A12)は取り消した移動先の床。PV1-3 は取消のあとの(戻った)床。
        if event.prior_location
          chain = context.location_chain(event.prior_location)
          extra[6] = Hl7::Types.pl_inpatient(location_code(chain["wa"]), location_code(chain["ro"]), location_code(chain["bd"]))
        end
        if %w[A01 A02 A12].include?(event.code)
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
