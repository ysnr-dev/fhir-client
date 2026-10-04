require "rails_helper"

RSpec.describe "Master::NursingStandardPlans", type: :request do
  def body
    JSON.parse(response.body)
  end

  before do
    Master::NursingTerm.create!(taxonomy: "diagnosis", level: "domain", code: "LD1", name: "安全")
    Master::NursingTerm.create!(taxonomy: "diagnosis", level: "class", code: "LC1", parent_code: "LD1", name: "身体損傷")
    Master::NursingTerm.create!(taxonomy: "diagnosis", level: "term", code: "L001", parent_code: "LC1",
                                name: "転倒転落の危険がある状態")
  end

  let(:payload) do
    {
      code: "SP001", name: "転倒転落予防", diagnosis_code: "L001",
      goals: [{ text: "転倒しない", outcome_code: "" }, { text: "" }],
      activities: [
        { activity_type: "op", text: "ふらつきの有無", item_kind: "observation", manage_no: "31000001", item_name: "ふらつき" },
        { activity_type: "tp", text: "ベッドを低床にする", item_kind: "", code16: "x", manage_no: "y" },
        { activity_type: "ep", text: "ナースコールの使い方を説明する" }
      ]
    }
  end

  it "作成でき、看護診断のコードで引ける" do
    post "/master/nursing_standard_plans", params: payload, as: :json
    expect(response).to have_http_status(:created)
    expect(body["goals"]).to eq([{ "text" => "転倒しない", "outcome_code" => "" }])
    # 看護行為・看護観察を紐付けない行はコードを持たない。
    expect(body["activities"][1]).to include("item_kind" => "", "code16" => "", "manage_no" => "")

    get "/master/nursing_standard_plans", params: { diagnosis_code: "L001" }
    expect(body["items"].map { |i| i["code"] }).to eq(%w[SP001])
  end

  it "看護診断に結びつかない計画だけを引ける" do
    post "/master/nursing_standard_plans", params: payload, as: :json
    post "/master/nursing_standard_plans", params: payload.merge(code: "SP002", name: "術後せん妄の予防", diagnosis_code: ""), as: :json

    get "/master/nursing_standard_plans", params: { diagnosis_code: "none" }
    expect(body["items"].map { |i| i["code"] }).to eq(%w[SP002])
  end

  it "未登録の看護診断と、種類の無い行を拒む" do
    post "/master/nursing_standard_plans", params: payload.merge(diagnosis_code: "L999"), as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/nursing_standard_plans",
         params: payload.merge(activities: [{ activity_type: "xx", text: "a" }]), as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end
end
