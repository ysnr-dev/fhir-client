require "rails_helper"

RSpec.describe Integrations::Orca::IncomeApi do
  let(:gateway) do
    Class.new do
      attr_reader :calls
      attr_accessor :response

      def initialize
        @calls = []
      end

      def post(path, root, attributes, params: {})
        @calls << { path: path, root: root, attributes: attributes, params: params }
        Integrations::Orca::Gateway::Result.new(
          api_result: Integrations::Orca::ApiResult.from(response), body: response,
          request_xml: "<xml/>", response_body: "<xml/>"
        )
      end
    end.new
  end

  subject(:api) { described_class.new(gateway) }

  it "asks for the 患者 and 診療日 with the private_objects root" do
    gateway.response = { "Api_Result" => "0000" }

    api.settlements(patient_id: "2", date: "2026-09-20")

    expect(gateway.calls.first).to include(path: "/api01rv2/incomeinfv2", root: "private_objects",
                                           attributes: { "Patient_ID" => "2", "Perform_Date" => "2026-09-20" })
  end

  it "reads the 外来 伝票 of the day into neutral settlements with 未収 per 伝票" do
    gateway.response = {
      "Api_Result" => "0000",
      "Income_Information" => [
        { "Perform_Date" => "2026-09-20", "InOut" => "2", "Invoice_Number" => "0000053", "IssuedDate" => "2026-09-20",
          "Department_Code" => "01", "Rate_Cd" => "30",
          "Cd_Information" => { "Ac_Money" => "1,230", "Ic_Money" => "1000", "Oe_Money" => "0" },
          "Ac_Point_Information" => { "Ac_Ttl_Point" => "410" } },
        { "Perform_Date" => "2026-09-20", "InOut" => "1", "Invoice_Number" => "0000054",
          "Cd_Information" => { "Ac_Money" => "99999", "Ic_Money" => "0" } },
        { "Perform_Date" => "2026-09-19", "InOut" => "2", "Invoice_Number" => "0000050",
          "Cd_Information" => { "Ac_Money" => "500", "Ic_Money" => "500" } }
      ],
      "Unpaid_Money_Information" => [{ "Invoice_Number" => "0000053", "Unpaid_Money" => "230" }]
    }

    settlements = api.settlements(patient_id: "2", date: "2026-09-20")

    expect(settlements.length).to eq(1)
    expect(settlements.first.to_h).to include(
      date: "2026-09-20", department_code: "01", invoice_number: "0000053", issued_on: "2026-09-20",
      charge: 1230, paid: 1000, unpaid: 230, self_pay: 0, copay_rate: 30, points: 410
    )
  end

  it "derives 未収 from 請求 − 入金 when the 伝票 is not in the 未収 list" do
    gateway.response = {
      "Api_Result" => "0000",
      "Income_Information" => [{ "Perform_Date" => "2026-09-20", "InOut" => "2", "Invoice_Number" => "1",
                                 "Cd_Information" => { "Ac_Money" => "1230", "Ic_Money" => "1230" } }]
    }

    expect(api.settlements(patient_id: "2", date: "2026-09-20").first.unpaid).to eq(0)
  end

  it "is empty when the 日レセ reports an error" do
    gateway.response = { "Api_Result" => "0004", "Api_Result_Message" => "患者番号の設定に誤りがあります" }

    expect(api.settlements(patient_id: "x", date: "2026-09-20")).to eq([])
  end
end
