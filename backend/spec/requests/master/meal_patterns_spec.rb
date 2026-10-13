require "rails_helper"

RSpec.describe "Master::MealPatterns", type: :request do
  def body
    JSON.parse(response.body)
  end

  let(:liquid) { { code: "A00131", name: "流動食600kcal" } }
  let(:regular) { { code: "A00103", name: "一般食1800kcal" } }
  let(:empty_staples) { { breakfast: nil, lunch: nil, dinner: nil } }

  let(:steps) do
    [
      { meals: 3, diet: liquid, dietIsFasting: false, staples: empty_staples, sideDishForm: nil,
        saltLimit: "", fastingReason: "", comment: "" },
      { meals: nil, diet: regular, dietIsFasting: false, staples: empty_staples, sideDishForm: nil,
        saltLimit: "", fastingReason: "", comment: "" }
    ]
  end

  it "表示順で返し、名称で絞れる" do
    Master::MealPattern.create!(pattern_code: "P00002", name: "大腸検査食", name_kana: "ダイチョウケンサショク",
                                steps: steps, display_order: 20)
    Master::MealPattern.create!(pattern_code: "P00001", name: "術後食上げ", name_kana: "ジュツゴショクアゲ",
                                steps: steps, display_order: 10)

    get "/master/meal_patterns"
    expect(body["items"].map { |i| i["name"] }).to eq(%w[術後食上げ 大腸検査食])

    get "/master/meal_patterns", params: { name: "だいちょう" }
    expect(body["items"].map { |i| i["name"] }).to eq(%w[大腸検査食])
  end

  it "作成・更新・削除でき、コードを自動採番し、段階の知らないキーは捨てる" do
    post "/master/meal_patterns",
         params: { name: "術後食上げ", steps: steps.map { |s| s.merge(bogus: "x") } },
         as: :json
    expect(response).to have_http_status(:created)
    expect(body["pattern_code"]).to eq("000001")
    expect(body["steps"].size).to eq(2)
    expect(body["steps"].first.keys).not_to include("bogus")
    expect(body["steps"].first["meals"]).to eq(3)
    expect(body["steps"].last["meals"]).to be_nil
    id = body["id"]

    patch "/master/meal_patterns/#{id}", params: { name: "術後食上げ(改)" }, as: :json
    expect(response).to have_http_status(:ok)
    expect(Master::MealPattern.find(id).name).to eq("術後食上げ(改)")
    expect(Master::MealPattern.find(id).steps.size).to eq(2)

    get "/master/meal_patterns/000001"
    expect(body["id"]).to eq(id)

    delete "/master/meal_patterns/#{id}"
    expect(response).to have_http_status(:no_content)
  end

  it "英字混じりのコードは採番の計算から外す" do
    Master::MealPattern.create!(pattern_code: "P00001", name: "seed", steps: steps)
    Master::MealPattern.create!(pattern_code: "000007", name: "手入力", steps: steps)

    post "/master/meal_patterns", params: { name: "次", steps: steps }, as: :json
    expect(body["pattern_code"]).to eq("000008")
  end

  it "段階が無い・食種が無い・食数が途中で空・食数が整数でないものは弾く" do
    post "/master/meal_patterns", params: { name: "x", steps: [] }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/meal_patterns", params: { name: "x", steps: [steps.first.merge(diet: nil)] }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/meal_patterns", params: { name: "x", steps: [steps.last, steps.first] }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
    expect(body["errors"].join).to include("1段階目の食数")

    post "/master/meal_patterns", params: { name: "x", steps: [steps.first.merge(meals: "1.5")] }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/meal_patterns", params: { name: "x", steps: [steps.first.merge(meals: 0)] }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "食数は文字列で届いても整数に揃える" do
    post "/master/meal_patterns", params: { name: "x", steps: [steps.first.merge(meals: "4")] }, as: :json
    expect(response).to have_http_status(:created)
    expect(body["steps"].first["meals"]).to eq(4)
  end
end
