require "rails_helper"

RSpec.describe "Master::MedicineIngredients", type: :request do
  describe "POST /master/medicine_ingredients/import" do
    it "取り込んで全件を入れ替える" do
      Master::MedicineIngredient.create!(code_prefix: "9999999", ingredient_id: 1, name: "old")
      file = fixture_file_upload("medicine_ingredients_sample.csv", "text/csv")

      post "/master/medicine_ingredients/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["imported"]).to eq(4)
      expect(Master::MedicineIngredient.find_by!(code_prefix: "2149110F1")).to have_attributes(atc_codes: "C09CA01", amount: 50, amount_unit: "mg")
      expect(Master::MedicineIngredient.pluck(:code_prefix).uniq).to contain_exactly("1143001", "3399102", "4229101", "2149110F1")
      gimeracil = Master::MedicineIngredient.find_by!(ingredient_id: 36_878_778)
      expect(gimeracil.name_ja).to be_nil
      expect(gimeracil.rxcui).to be_nil
      expect(gimeracil.atc_codes).to eq("")
      expect(gimeracil.amount).to be_nil
    end

    it "ファイルが無ければ 422" do
      post "/master/medicine_ingredients/import", params: {}

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/medicine_ingredients" do
    it "全件をコード順に返す(配合剤は成分の数だけ)" do
      Master::MedicineIngredient.create!(code_prefix: "3399102", ingredient_id: 929_887, name: "lansoprazole", name_ja: "ランソプラゾール")
      Master::MedicineIngredient.create!(code_prefix: "3399102", ingredient_id: 1_112_807, name: "aspirin", name_ja: "アスピリン")
      Master::MedicineIngredient.create!(code_prefix: "1143001", ingredient_id: 1_112_807, name: "aspirin", name_ja: "アスピリン")

      get "/master/medicine_ingredients"

      expect(response).to have_http_status(:ok)
      rows = JSON.parse(response.body)
      expect(rows.map { |r| [r["code_prefix"], r["ingredient_id"]] }).to eq(
        [["1143001", 1_112_807], ["3399102", 929_887], ["3399102", 1_112_807]],
      )
      expect(rows.first).to include("name" => "aspirin", "name_ja" => "アスピリン", "atc_codes" => [], "amount" => nil)
    end

    it "ATC 分類は配列、配合剤の含量は数値で返す" do
      Master::MedicineIngredient.create!(code_prefix: "2149110F1", ingredient_id: 1_367_500, name: "losartan",
                                         atc_codes: "C09CA01", amount: 50, amount_unit: "mg")

      get "/master/medicine_ingredients"

      expect(JSON.parse(response.body).first).to include("atc_codes" => ["C09CA01"], "amount" => 50.0, "amount_unit" => "mg")
    end
  end
end
