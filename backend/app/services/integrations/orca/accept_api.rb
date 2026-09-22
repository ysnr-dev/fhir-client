module Integrations
  module Orca
    # 受付一覧(acceptlstv2)。会計が済んだ受診を引くのに使う。
    #
    # class=01 が受付中(会計待ち)、02 が会計済み、03 が両方。患者では絞れず日付単位で
    # 返ってくるので、応答の Patient_ID(ゼロ埋めされている)で自分の患者を探す。
    class AcceptApi
      PATH = "/api01rv2/acceptlstv2".freeze
      SETTLED = "02".freeze

      def initialize(gateway)
        @gateway = gateway
      end

      # その日の会計が済んでいるか。診療科を渡せばその科の受付だけを見る。
      def settled?(patient_id:, date:, department_code: nil)
        attributes = { "Acceptance_Date" => date.to_s, "Department_Code" => department_code }.compact_blank
        result = gateway.post(PATH, "acceptlstreq", attributes, params: { "class" => SETTLED })
        return false unless result.ok?

        Array(result.body["Acceptlst_Information"]).any? do |row|
          next false unless row.is_a?(Hash)
          next false unless ReceiptComputer::PatientResource.same_number?(row["Patient_ID"], patient_id)

          department_code.blank? || row["Department_Code"].to_s == department_code.to_s
        end
      rescue Gateway::InvalidResponse
        false
      end

      private

      attr_reader :gateway
    end
  end
end
