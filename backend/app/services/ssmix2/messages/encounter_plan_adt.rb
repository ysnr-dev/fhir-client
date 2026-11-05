module Ssmix2
  module Messages
    # 入院(Encounter、class=IMP)の予定。入院予定(ADT^A14 / 取消 A27)、退院予定(ADT^A16 / 取消 A25)、
    # 転科転棟予定(ADT^A15 / 取消 A26)。入院予定は status=planned の Encounter、退院予定と転科転棟予定は
    # 在院中の Encounter のローカル拡張で、どの事象かは前の版との比較で決める。
    # 予定どおりに実施された(入院実施・退院実施・転棟実施で予定が消えた)ときは取消を起こさない。
    class EncounterPlanAdt < Base
      Event = Struct.new(:code, :structure, :data_kind, :process, :service_date, :order_ref, :pv1_extra, :pv2_extra, keyword_init: true)

      def build
        encounter = written.resource
        return nil if encounter.nil? || !inpatient?(encounter)

        previous = previous_version("Encounter", encounter)
        event = admission_plan(encounter, previous) || discharge_plan(encounter, previous) || transfer_plan(encounter, previous)
        return nil if event.nil?

        patient = patient_of(encounter.dig("subject", "reference"))
        msh("ADT^#{event.code}^#{event.structure}")
        evn
        pid(patient)
        pv1(patient, encounter: encounter, extra: event.pv1_extra)
        pv2(event.pv2_extra)
        result(data_kind: event.data_kind, service_date: event.service_date, order_no: OrderNumber.for(event.order_ref),
               process: event.process, department_code: department_code_of(encounter.dig("serviceProvider", "reference")))
      end

      private

      # 入院予定。planned の登録・修正は A14、planned からの取消・誤登録は A27。
      def admission_plan(encounter, previous)
        ref = "Encounter/#{encounter['id']}#A14"
        planned_at = encounter.dig("period", "start")
        if encounter["status"] == "planned"
          extra = { 3 => planned_location(encounter), 44 => "" }
          code = Fhir.department_code(context.by_reference(encounter.dig("serviceProvider", "reference")))
          extra[10] = code if code
          event("A14", "ADT_A05", "ADT-21", "INS", planned_at, ref, extra, { 8 => Hl7::Stamp.format(planned_at) })
        elsif previous&.dig("status") == "planned" && %w[cancelled entered-in-error].include?(encounter["status"])
          planned_at = previous.dig("period", "start")
          event("A27", "ADT_A21", "ADT-21", "DEL", planned_at, ref, { 3 => planned_location(previous), 44 => "" },
                { 1 => planned_location(previous), 8 => Hl7::Stamp.format(planned_at) })
        end
      end

      # 退院予定。在院中に予定が付いた・変わったら A16、在院中のまま予定が消えたら A25。
      def discharge_plan(encounter, previous)
        return nil unless encounter["status"] == "in-progress"

        ref = "Encounter/#{encounter['id']}#A16"
        plan = Fhir.extension(encounter, Fhir::DISCHARGE_PLAN_EXT_URL)
        before = Fhir.extension(previous, Fhir::DISCHARGE_PLAN_EXT_URL)
        if plan && plan != before
          at = Fhir.extension_child(plan, "date")
          event("A16", "ADT_A16", "ADT-51", "INS", at, ref, {}, { 9 => Hl7::Stamp.format(at) })
        elsif plan.nil? && before && previous["status"] == "in-progress"
          at = Fhir.extension_child(before, "date")
          event("A25", "ADT_A21", "ADT-51", "DEL", at, ref, {}, { 9 => Hl7::Stamp.format(at) })
        end
      end

      # 転科転棟予定。予定が付いた・変わったら A15、移動せずに予定が消えたら A26。
      def transfer_plan(encounter, previous)
        return nil unless encounter["status"] == "in-progress"

        ref = "Encounter/#{encounter['id']}#A15"
        plan = Fhir.extension(encounter, Fhir::TRANSFER_PLAN_EXT_URL)
        before = Fhir.extension(previous, Fhir::TRANSFER_PLAN_EXT_URL)
        if plan && plan != before
          date = Fhir.extension_child(plan, "date")
          extra = {}
          department = Fhir.extension_child(plan, "department")&.dig("reference")
          code = department && Fhir.department_code(context.by_reference(department))
          extra[10] = code if code
          event("A15", "ADT_A15", "ADT-41", "INS", date, ref, extra, { 8 => Hl7::Stamp.format(date) })
        elsif plan.nil? && before && previous["status"] == "in-progress" && !moved?(encounter, previous)
          date = Fhir.extension_child(before, "date")
          event("A26", "ADT_A21", "ADT-41", "DEL", date, ref, {}, { 1 => plan_location(before), 8 => Hl7::Stamp.format(date) })
        end
      end

      def moved?(encounter, previous)
        Array(encounter["location"]).size > Array(previous["location"]).size ||
          encounter.dig("serviceProvider", "reference") != previous.dig("serviceProvider", "reference")
      end

      # 転科転棟予定の移動先(病棟^病室^ベッド^^^N)。
      def plan_location(plan)
        codes = %w[ward room bed].map do |child|
          reference = Fhir.extension_child(plan, child)&.dig("reference")
          reference ? location_code(context.by_reference(reference)) : ""
        end
        Hl7::Types.pl_inpatient(*codes)
      end

      def event(code, structure, data_kind, process, service_date, order_ref, pv1_extra, pv2_extra)
        Event.new(code: code, structure: structure, data_kind: data_kind, process: process,
                  service_date: Hl7::Stamp.day(service_date).presence || UNDATED, order_ref: order_ref,
                  pv1_extra: pv1_extra, pv2_extra: pv2_extra)
      end
    end
  end
end
