require "rails_helper"

RSpec.describe "Master::MedicineDoseConversions", type: :request do
  def valid_attrs(overrides = {})
    { medicine_code: "620000242", from_unit: "mg", factor: 5, to_unit: "管", source: "manual" }.merge(overrides)
  end

  def items
    JSON.parse(response.body)["items"]
  end

  describe "GET /master/medicine_dose_conversions" do
    before do
      Master::Medicine.create!(medicine_code: "620000242", name: "セレネース注５ｍｇ", unit_name: "管", dosage_form: "4")
      Master::Medicine.create!(medicine_code: "610453063", name: "セレネース錠０．７５ｍｇ", unit_name: "錠", dosage_form: "1")
      Master::HotCode.create!(hot_code: "1", receipt_code_1: "620000242", standard_unit: "０．５％１ｍＬ１管")
      Master::MedicineDoseConversion.create!(valid_attrs)
      Master::MedicineDoseConversion.create!(
        medicine_code: "620000242", from_unit: "mL", factor: 1, to_unit: "管", source: "volume", needs_review: true
      )
      Master::MedicineDoseConversion.create!(
        medicine_code: "610453063", from_unit: "mg", factor: 0.75, to_unit: "錠", source: "explicit"
      )
    end

    it "医薬品名・剤形・規格単位を添えて返す" do
      get "/master/medicine_dose_conversions", params: { medicine_code: "620000242", source: "manual" }

      expect(items.size).to eq(1)
      expect(items.first).to include(
        "medicine_name" => "セレネース注５ｍｇ", "dosage_form" => "4",
        "standard_unit" => "０．５％１ｍＬ１管", "to_unit" => "管"
      )
    end

    it "医薬品名の表記ゆれを吸収して検索できる" do
      get "/master/medicine_dose_conversions", params: { name: "セレネース錠0.75mg" }

      expect(items.map { |i| i["medicine_code"] }).to eq(["610453063"])
    end

    it "剤形で絞り込む" do
      get "/master/medicine_dose_conversions", params: { dosage_form: "1" }

      expect(items.map { |i| i["medicine_code"] }).to eq(["610453063"])
    end

    it "要確認のものだけに絞り込む" do
      get "/master/medicine_dose_conversions", params: { needs_review: "true" }

      expect(items.map { |i| i["from_unit"] }).to eq(["mL"])
    end
  end

  describe "GET /master/medicine_dose_conversions/unmapped" do
    before do
      Master::Medicine.create!(medicine_code: "620000242", name: "セレネース注５ｍｇ", unit_name: "管", dosage_form: "4")
      Master::Medicine.create!(medicine_code: "621662301", name: "ツルバダ配合錠", unit_name: "錠",
                               dosage_form: "1", yakka_code: "6250103F1036")
      Master::HotCode.create!(hot_code: "1", individual_medicine_code: "6250103F1036", standard_unit: "１錠")
      Master::MedicineDoseConversion.create!(valid_attrs)
    end

    it "換算行を1件も持たない医薬品だけを規格単位付きで返す" do
      get "/master/medicine_dose_conversions/unmapped"

      expect(items.size).to eq(1)
      expect(items.first).to include(
        "medicine_code" => "621662301", "name" => "ツルバダ配合錠",
        "unit_name" => "錠", "standard_unit" => "１錠"
      )
    end

    it "剤形で絞り込む" do
      get "/master/medicine_dose_conversions/unmapped", params: { dosage_form: "4" }

      expect(items).to be_empty
    end
  end

  describe "POST /master/medicine_dose_conversions/generate" do
    before do
      Master::Medicine.create!(medicine_code: "620000242", name: "セレネース注５ｍｇ", unit_name: "管", dosage_form: "4")
      Master::HotCode.create!(hot_code: "1", receipt_code_1: "620000242", standard_unit: "０．５％１ｍＬ１管")
    end

    it "未紐付けの医薬品に換算行を作る" do
      post "/master/medicine_dose_conversions/generate"

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to include("created" => 2, "medicines" => 1, "skipped" => 0)
      expect(Master::MedicineDoseConversion.count).to eq(2)
    end

    it "2回目は既存分をスキップして何も作らない" do
      post "/master/medicine_dose_conversions/generate"
      post "/master/medicine_dose_conversions/generate"

      expect(JSON.parse(response.body)).to include("created" => 0, "skipped" => 1)
      expect(Master::MedicineDoseConversion.count).to eq(2)
    end
  end

  describe "CRUD" do
    before do
      Master::Medicine.create!(medicine_code: "620000242", name: "セレネース注５ｍｇ", unit_name: "管", dosage_form: "4")
    end

    it "creates, reads, updates, and deletes a record" do
      post "/master/medicine_dose_conversions", params: valid_attrs, as: :json
      expect(response).to have_http_status(:created)
      id = JSON.parse(response.body)["id"]

      get "/master/medicine_dose_conversions/#{id}"
      expect(JSON.parse(response.body)).to include("factor" => "5.0", "source" => "manual")

      patch "/master/medicine_dose_conversions/#{id}", params: { factor: 2.5, note: "添付文書より" }, as: :json
      expect(JSON.parse(response.body)).to include("factor" => "2.5", "note" => "添付文書より")

      delete "/master/medicine_dose_conversions/#{id}"
      expect(response).to have_http_status(:no_content)
    end

    it "to_unit を省略すると医薬品マスタの単位を補う" do
      post "/master/medicine_dose_conversions", params: valid_attrs(to_unit: nil), as: :json

      expect(response).to have_http_status(:created)
      expect(JSON.parse(response.body)["to_unit"]).to eq("管")
    end

    it "自動生成された行を修正すると導出根拠が manual になる" do
      record = Master::MedicineDoseConversion.create!(valid_attrs(source: "explicit"))

      patch "/master/medicine_dose_conversions/#{record.id}", params: { factor: 10 }, as: :json

      expect(JSON.parse(response.body)["source"]).to eq("manual")
    end

    it "returns 422 for a duplicate input unit" do
      post "/master/medicine_dose_conversions", params: valid_attrs, as: :json
      post "/master/medicine_dose_conversions", params: valid_attrs(factor: 9), as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "returns 422 when factor is not positive" do
      post "/master/medicine_dose_conversions", params: valid_attrs(factor: 0), as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
