module Integrations
  module Orca
    # 収納情報(incomeinfv2)。会計が済んだ受診の請求額・入金額・未収額を引く。
    #
    # 患者と診療日で問い合わせると、その日の伝票(外来なら診療科ごと)が Income_Information に
    # 並ぶ。金額は円の整数文字列。未収は伝票番号ごとに Unpaid_Money_Information で返る。
    # Api_Result は 4 桁("0000" が正常)。
    class IncomeApi
      PATH = "/api01rv2/incomeinfv2".freeze
      OUTPATIENT = "2".freeze

      def initialize(gateway)
        @gateway = gateway
      end

      # その日の外来の会計。無ければ空。
      def settlements(patient_id:, date:)
        result = gateway.post(PATH, "private_objects", { "Patient_ID" => patient_id, "Perform_Date" => date.to_s })
        return [] unless result.ok?

        unpaid = Array(result.body["Unpaid_Money_Information"]).select { |u| u.is_a?(Hash) }
                                                                 .to_h { |u| [u["Invoice_Number"].to_s, money(u["Unpaid_Money"])] }

        Array(result.body["Income_Information"]).select { |row| row.is_a?(Hash) }.filter_map do |row|
          next if row["InOut"].present? && row["InOut"].to_s != OUTPATIENT
          next if row["Perform_Date"].present? && row["Perform_Date"].to_s != date.to_s

          cd = row["Cd_Information"] || {}
          charge = money(cd["Ac_Money"])
          paid = money(cd["Ic_Money"])
          ReceiptComputer::Records::Settlement.new(
            date: row["Perform_Date"].presence || date.to_s,
            department_code: row["Department_Code"].presence,
            invoice_number: row["Invoice_Number"].presence,
            issued_on: row["IssuedDate"].presence,
            charge: charge,
            paid: paid,
            unpaid: unpaid.fetch(row["Invoice_Number"].to_s) { charge - paid },
            self_pay: money(cd["Oe_Money"]),
            copay_rate: row["Rate_Cd"].presence&.to_i,
            points: money(row.dig("Ac_Point_Information", "Ac_Ttl_Point"))
          )
        end
      rescue Gateway::InvalidResponse
        []
      end

      private

      attr_reader :gateway

      def money(value) = value.to_s.delete(",").to_i
    end
  end
end
