module Ssmix2
  module Messages
    # 外来受付(ADT^A04、データ種別 ADT-12)。受付済(checked-in)になった Appointment から起こす。
    # 外来の Encounter は診察開始で建つので受付ではない。
    class AppointmentA04 < Base
      def build
        appointment = written.resource
        return nil if appointment.nil? || appointment["status"] != "checked-in"
        return nil if already_checked_in_before?(appointment)

        patient_reference = Array(appointment["participant"]).map { |p| p.dig("actor", "reference") }
                                                              .find { |r| r.to_s.start_with?("Patient/") }
        return nil if patient_reference.nil?

        patient = patient_of(patient_reference)
        checked_in_at = Fhir.extension(appointment, Fhir::APPOINTMENT_CHECKED_IN_AT_EXT_URL)&.dig("valueDateTime") ||
                        appointment["start"] || transaction.occurred_at
        department = Array(appointment["specialty"]).filter_map { |s| Fhir.coding(s, Fhir::DEPARTMENT_CODE_SYSTEM) }.first
        practitioner = Array(appointment["participant"]).map { |p| p.dig("actor", "reference") }
                                                        .find { |r| r.to_s.start_with?("Practitioner/") }

        msh("ADT^A04^ADT_A01")
        evn
        pid(patient)
        extra = { 44 => Hl7::Stamp.format(checked_in_at) }
        extra[7] = practitioner_xcn(practitioner) if practitioner
        pv1(patient, encounter: nil, department_code: department&.dig("code"), extra: extra)
        result(data_kind: "ADT-12", service_date: Hl7::Stamp.day(checked_in_at), order_no: OrderNumber.for("Appointment/#{appointment['id']}"),
               process: "INS", department_code: department&.dig("code"))
      end

      private

      # 受付済のまま担当医などを変えただけの更新は受付の事象ではない。
      def already_checked_in_before?(appointment)
        return false if written.method == "POST" || written.version.nil? || written.version <= 1

        previous = context.vread("Appointment", appointment["id"], written.version - 1)
        previous&.dig("status") == "checked-in"
      end
    end
  end
end
