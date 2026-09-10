require "rails_helper"

RSpec.describe "Master::LabReferenceRanges", type: :request do
  def body
    JSON.parse(response.body)
  end

  before do
    Master::LabResultItem.create!(result_item_code: "R0001", name: "クレアチニン", data_type: "PQ", display_unit: "mg/dL")
  end

  it "結果項目コードのカンマ区切りで基準値を並び順で引ける" do
    Master::LabReferenceRange.create!(result_item_code: "R0001", sex: "female", lower_limit: 0.46, upper_limit: 0.79, display_order: 20)
    Master::LabReferenceRange.create!(result_item_code: "R0001", sex: "male", lower_limit: 0.65, upper_limit: 1.07, display_order: 10)
    Master::LabReferenceRange.create!(result_item_code: "R0002", lower_limit: 1, upper_limit: 2)

    get "/master/lab_reference_ranges", params: { result_item_code: "R0001" }

    expect(body["items"].map { |r| r["sex"] }).to eq(%w[male female])
    expect(body["items"].first["lower_limit"]).to eq("0.65")
  end

  it "結果項目の一覧・詳細に基準値が入れ子で付く" do
    Master::LabReferenceRange.create!(result_item_code: "R0001", lower_limit: 0.6, upper_limit: 1.1)

    get "/master/lab_result_items", params: { result_item_code: "R0001" }
    expect(body["items"].first["reference_ranges"].size).to eq(1)

    get "/master/lab_result_items/R0001"
    expect(body["reference_ranges"].first["upper_limit"]).to eq("1.1")
  end

  it "追加時に並び順を採番し、下限と上限の両方が空・逆転した上下限・逆転した年齢は登録できない" do
    post "/master/lab_reference_ranges", params: { result_item_code: "R0001", lower_limit: 0.6, upper_limit: 1.1 }, as: :json
    expect(response).to have_http_status(:created)
    expect(body["display_order"]).to eq(1)

    post "/master/lab_reference_ranges", params: { result_item_code: "R0001", sex: "male" }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/lab_reference_ranges", params: { result_item_code: "R0001", lower_limit: 2, upper_limit: 1 }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/lab_reference_ranges", params: { result_item_code: "R0001", lower_limit: 1, age_from: 65, age_to: 18 }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/lab_reference_ranges", params: { result_item_code: "R0001", lower_limit: 1, sex: "other" }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end

  describe "パニック値(緊急異常値)" do
    it "基準値と同じ行に持ち、一覧・詳細に添えて返る" do
      Master::LabReferenceRange.create!(result_item_code: "R0001", lower_limit: 3.6, upper_limit: 4.8,
                                        panic_lower: 2.5, panic_upper: 6.5)

      get "/master/lab_result_items/R0001"

      range = body["reference_ranges"].first
      expect(range["panic_lower"]).to eq("2.5")
      expect(range["panic_upper"]).to eq("6.5")
    end

    it "基準値を持たずパニック値だけの行も登録できる" do
      post "/master/lab_reference_ranges", params: { result_item_code: "R0001", panic_upper: 6.5 }, as: :json
      expect(response).to have_http_status(:created)
    end

    it "基準値の内側に入るパニック値・逆転したパニック値は登録できない" do
      post "/master/lab_reference_ranges", params: {
        result_item_code: "R0001", lower_limit: 3.6, upper_limit: 4.8, panic_lower: 4.0,
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/master/lab_reference_ranges", params: {
        result_item_code: "R0001", lower_limit: 3.6, upper_limit: 4.8, panic_upper: 4.5,
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/master/lab_reference_ranges", params: {
        result_item_code: "R0001", panic_lower: 7, panic_upper: 2,
      }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  it "更新・削除でき、結果項目を消すと基準値も消える" do
    range = Master::LabReferenceRange.create!(result_item_code: "R0001", lower_limit: 0.6, upper_limit: 1.1)

    patch "/master/lab_reference_ranges/#{range.id}", params: { upper_limit: 1.2 }, as: :json
    expect(body["upper_limit"]).to eq("1.2")

    delete "/master/lab_reference_ranges/#{range.id}"
    expect(response).to have_http_status(:no_content)

    Master::LabReferenceRange.create!(result_item_code: "R0001", lower_limit: 0.6, upper_limit: 1.1)
    delete "/master/lab_result_items/R0001"
    expect(Master::LabReferenceRange.count).to eq(0)
  end
end
