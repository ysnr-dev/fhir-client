module Ssmix2
  module Messages
    # 患者基本情報の更新(ADT^A08、データ種別 ADT-00)。Patient の作成・更新のたびに最新の患者情報を送る。
    class AdtA08 < Base
      def build
        patient = written.resource
        msh("ADT^A08^ADT_A01")
        evn
        pid(patient, with_updated_at: true)
        pv1(patient)
        result(data_kind: "ADT-00", service_date: UNDATED, order_no: OrderNumber::NONE, process: "INS",
               department_code: nil)
      end
    end
  end
end
