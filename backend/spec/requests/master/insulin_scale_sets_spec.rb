require "rails_helper"

RSpec.describe "Master::InsulinScaleSets", type: :request do
  def body
    JSON.parse(response.body)
  end

  let(:glucose_rows) do
    [
      { high: "150", dose: "0" },
      { low: "151", high: "200", dose: "2" },
      { low: "201", dose: "4", note: "Dr コール" }
    ]
  end

  it "表示順で返し、種別で絞れる" do
    Master::InsulinScaleSet.create!(name: "食事量", kind: "meal", rows: [{ low: "0", high: "100", dose: "2" }], display_order: 20)
    Master::InsulinScaleSet.create!(name: "標準", kind: "glucose", rows: glucose_rows, display_order: 10)

    get "/master/insulin_scale_sets"
    expect(body["items"].map { |i| i["name"] }).to eq(%w[標準 食事量])

    get "/master/insulin_scale_sets", params: { kind: "meal" }
    expect(body["items"].map { |i| i["name"] }).to eq(%w[食事量])
  end

  it "作成・更新・削除でき、空の行と知らないキーは捨てる" do
    post "/master/insulin_scale_sets",
         params: { name: "標準", kind: "glucose", rows: glucose_rows + [{ low: "", high: "", dose: "", note: "" }] },
         as: :json
    expect(response).to have_http_status(:created)
    id = body["id"]
    expect(body["rows"].size).to eq(3)
    expect(body["rows"].last).to eq("low" => "201", "dose" => "4", "note" => "Dr コール")

    patch "/master/insulin_scale_sets/#{id}", params: { name: "標準(改)" }, as: :json
    expect(Master::InsulinScaleSet.find(id).name).to eq("標準(改)")

    delete "/master/insulin_scale_sets/#{id}"
    expect(response).to have_http_status(:no_content)
  end

  it "フリースケールは条件が必須で、幅は要らない" do
    post "/master/insulin_scale_sets",
         params: { name: "フリー", kind: "free", rows: [{ condition: "BS 200 以上かつ食事 5 割以上", dose: "4" }] },
         as: :json
    expect(response).to have_http_status(:created)

    post "/master/insulin_scale_sets", params: { name: "x", kind: "free", rows: [{ dose: "4" }] }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "行が無い・単位が数値でない・幅が無い・種別が違うものは弾く" do
    post "/master/insulin_scale_sets", params: { name: "x", kind: "glucose", rows: [] }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/insulin_scale_sets", params: { name: "x", kind: "glucose", rows: [{ low: "1", dose: "a" }] }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/insulin_scale_sets", params: { name: "x", kind: "glucose", rows: [{ dose: "2" }] }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/insulin_scale_sets", params: { name: "x", kind: "bogus", rows: glucose_rows }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end
end
