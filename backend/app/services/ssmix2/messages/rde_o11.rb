module Ssmix2
  module Messages
    # 処方(OMP-01)と注射(OMP-02)のオーダー(RDE^O11)。オーダーヘッダーの ServiceRequest と、それを basedOn で
    # 指す MedicationRequest から組む。処方は MedicationRequest ごとに ORC/RXE/TQ1/RXR、注射は RP(剤グループ)ごとに
    # ORC/RXE/TQ1/RXR と成分の RXC。取消(status revoked など)と削除は ORC-1 CA の DEL。
    class RdeO11 < Base
      include MedicationSegments

      def build
        header = written.resource || context.last_version("ServiceRequest", written.id)
        return nil if header.nil?

        kind = Fhir.order_type(header)
        return nil unless %w[prescription injection].include?(kind)

        patient = patient_of(header.dig("subject", "reference"))
        requests = medication_requests(header)
        deleted = written.method == "DELETE" || cancelled?(header)
        order_control = deleted ? "CA" : "NW"
        order_no = OrderNumber.for("ServiceRequest/#{header['id']}")
        inpatient = inpatient_setting?(header, Fhir::PRESCRIPTION_SETTING_SYSTEM)

        msh("RDE^O11^RDE_O11")
        pid(patient)
        pv1(patient, encounter: inpatient ? :current : nil, department_code: department_code_of(Fhir.department_reference(header)))
        if kind == "prescription"
          prescription_groups(requests).each { |mr| prescription_order(header, mr, order_control, order_no, inpatient) }
        else
          injection_groups(requests).each { |rp, mrs| injection_order(header, rp, mrs, order_control, order_no, inpatient) }
        end
        result(data_kind: kind == "prescription" ? "OMP-01" : "OMP-02", service_date: Hl7::Stamp.day(header["authoredOn"]),
               order_no: order_no, process: deleted ? "DEL" : "INS",
               department_code: department_code_of(Fhir.department_reference(header)))
      end
    end
  end
end
