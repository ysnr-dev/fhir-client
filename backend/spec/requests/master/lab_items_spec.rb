require "rails_helper"

RSpec.describe "Master::LabItems", type: :request do
  def valid_attrs(overrides = {})
    { jlac11_code: "C9999999999999999", fhir_item_name: "テスト検査項目" }.merge(overrides)
  end

  describe "POST /master/lab_items/import" do
    it "imports the uploaded file" do
      file = fixture_file_upload("lab_items_sample.csv", "text/csv")

      post "/master/lab_items/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["imported"]).to eq(3)
      expect(Master::LabItem.count).to eq(3)
    end

    it "returns 422 when file is missing" do
      post "/master/lab_items/import", params: {}

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/lab_items (検索)" do
    before do
      Master::LabItem.create!(
        jlac11_code: "C1000000000000001", jlac10_code: "3A010000002327101",
        category_name: "生化学検査", fhir_item_name: "総蛋白(TP)", abbreviation: "TP"
      )
      Master::LabItem.create!(
        jlac11_code: "C1000000000000002", jlac10_code: "3B035000002327201",
        category_name: "生化学検査", fhir_item_name: "ＡＳＴ(ＧＯＴ)", abbreviation: "AST"
      )
      Master::LabItem.create!(
        jlac11_code: "C1000000000000003",
        category_name: "血液学的検査", fhir_item_name: "白血球数", abbreviation: "WBC"
      )
    end

    def names_for(params)
      get "/master/lab_items", params: params
      JSON.parse(response.body)["items"].map { |i| i["fhir_item_name"] }
    end

    it "名称の表記ゆれ(全角半角の違い)を吸収して検索できる" do
      expect(names_for(name: "総蛋白")).to eq(["総蛋白(TP)"])
      expect(names_for(name: "AST(GOT)")).to eq(["ＡＳＴ(ＧＯＴ)"])
    end

    it "略称でもヒットする" do
      expect(names_for(name: "wbc")).to eq(["白血球数"])
    end

    it "jlac11_code の完全一致で絞り込む" do
      expect(names_for(jlac11_code: "C1000000000000002")).to eq(["ＡＳＴ(ＧＯＴ)"])
    end

    it "jlac10_code の完全一致で絞り込む" do
      expect(names_for(jlac10_code: "3A010000002327101")).to eq(["総蛋白(TP)"])
    end

    it "category_name(区分名称)で絞り込む" do
      expect(names_for(category_name: "血液学的検査")).to eq(["白血球数"])
    end
  end

  describe "CRUD" do
    it "creates, reads, updates, lists, and deletes a record" do
      post "/master/lab_items", params: valid_attrs, as: :json
      expect(response).to have_http_status(:created)
      id = JSON.parse(response.body)["id"]

      get "/master/lab_items/#{id}"
      expect(JSON.parse(response.body)["fhir_item_name"]).to eq("テスト検査項目")

      patch "/master/lab_items/#{id}", params: { fhir_item_name: "更新後" }, as: :json
      expect(JSON.parse(response.body)["fhir_item_name"]).to eq("更新後")

      get "/master/lab_items", params: { name: "更新後" }
      expect(JSON.parse(response.body)["total"]).to eq(1)

      delete "/master/lab_items/#{id}"
      expect(response).to have_http_status(:no_content)
    end

    it "returns 422 when jlac11_code is missing" do
      post "/master/lab_items", params: { fhir_item_name: "無効" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "returns 422 for a duplicate jlac11_code" do
      post "/master/lab_items", params: valid_attrs, as: :json
      post "/master/lab_items", params: valid_attrs, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
