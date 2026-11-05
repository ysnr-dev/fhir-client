module Ssmix2
  module Messages
    # 放射線(OMG-01)・内視鏡(OMG-02)・生理(OMG-03)の検査オーダー(OMG^O19)。ヘッダーの ServiceRequest と
    # 明細(セットは構成項目に展開)から、オーダー制御(NW / CA)・親(PA)・子(CH)の ORC / TQ1 / OBR を組む。
    # 取消・削除は ORC-1 CA の DEL で、親以下は送らない。
    class OmgO19 < Base
      include ExamOrderSegments

      def build
        header = written.resource || context.last_version("ServiceRequest", written.id)
        return nil if header.nil?

        spec = KINDS[Fhir.order_type(header)]
        return nil if spec.nil?

        patient = patient_of(header.dig("subject", "reference"))
        leaves = exam_items(header, spec)
        deleted = written.method == "DELETE" || cancelled?(header)
        order_no = OrderNumber.for("ServiceRequest/#{header['id']}")
        inpatient = inpatient_setting?(header, Fhir::PRESCRIPTION_SETTING_SYSTEM)
        department = department_code_of(Fhir.department_reference(header))
        parent_code = parent_code_cwe(spec, leaves)

        msh("OMG^O19^OMG_O19")
        pid(patient)
        pv1(patient, encounter: encounter_for(header, inpatient), department_code: department)
        orc(deleted ? "CA" : "NW", order_no, header, inpatient: inpatient)
        exam_tq1(header)
        exam_obr(order_no, parent_code, header)
        unless deleted
          orc("PA", order_no, header, inpatient: inpatient)
          exam_tq1(header)
          exam_obr(order_no, parent_code, header)
          leaves.each do |item|
            child_no = child_order_no(item)
            orc("CH", child_no, header, inpatient: inpatient, extra: { 8 => Hl7::Types.ei(order_no) })
            exam_tq1(header)
            exam_obr(child_no, item_code_cwe(spec, item), header, parent_no: order_no)
          end
        end
        result(data_kind: spec[:order_kind], service_date: Hl7::Stamp.day(header["authoredOn"]), order_no: order_no,
               process: deleted ? "DEL" : "INS", department_code: department)
      end
    end
  end
end
