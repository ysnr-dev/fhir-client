require "rails_helper"

RSpec.describe "Master::OralExamCodes", type: :request do
  def body
    JSON.parse(response.body)
  end

  before do
    Master::OralExamCode.create!(record: "TD", item: "TD-2", code: "51", display: "欠損歯【喪失歯△】",
                                 tf_ref: "TF-22", display_order: 262)
    Master::OralExamCode.create!(record: "TD", item: "TD-2", code: "02", display: "現在歯【健全歯／】（治療痕なし）",
                                 tf_ref: "TF-4", display_order: 241)
    Master::OralExamCode.create!(record: "TP", item: "TP-21", code: "01", display: "全部修復（全部金属冠・銀色）（ＦＭＣ）",
                                 tf_ref: "TF-16", display_order: 487)
  end

  it "掲載順で返す" do
    get "/master/oral_exam_codes", params: { per: 1000 }

    expect(body["total"]).to eq(3)
    expect(body["items"].map { |i| [i["item"], i["code"]] }).to eq([%w[TD-2 02], %w[TD-2 51], %w[TP-21 01]])
  end

  it "レコード・項目で絞れる" do
    get "/master/oral_exam_codes", params: { record: "TP" }
    expect(body["items"].map { |i| i["item"] }).to eq(%w[TP-21])

    get "/master/oral_exam_codes", params: { item: "TD-2" }
    expect(body["items"].size).to eq(2)
  end

  it "書き込みの経路は持たない" do
    post "/master/oral_exam_codes", params: { item: "TD-2" }
    expect(response).to have_http_status(:not_found)
  end
end
