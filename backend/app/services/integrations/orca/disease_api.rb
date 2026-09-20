module Integrations
  module Orca
    # 保険病名の登録(diseasev2)。
    #
    # medicalmodv2 の Disease_Information に載せる手もあるが、そちらは class=01 の
    # 初回登録でしか処理されず、同じ日に送り直す(class=03)と黙って無視される。
    # 初回と再送で挙動が変わるのは事故のもとなので、病名は常にこちらへ分けて送る。
    #
    # diseasev3 ではなく v2 を使う。v3 は同じ電文で「開始日が暦日ではありません」を
    # 返し続ける(v3 だけが Request_Number を持つ)。
    class DiseaseApi
      PATH = "/orca22/diseasev2".freeze

      # 廃止・移行先のある病名が混ざっていた。登録自体は行われるので警告として扱う。
      WARNING_RESULT = "E40".freeze

      def initialize(gateway)
        @gateway = gateway
      end

      def register(children, patient_id:, perform_date:, department_code:)
        attributes = {
          "Patient_ID" => patient_id,
          "Perform_Date" => perform_date.to_s,
          "Diagnosis_Information" => department_code.present? ? { "Department_Code" => department_code } : nil,
          "Disease_Information" => children
        }.compact

        gateway.post(PATH, "diseasereq", attributes)
      end

      private

      attr_reader :gateway
    end
  end
end
