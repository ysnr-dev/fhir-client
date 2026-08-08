require "rails_helper"

RSpec.describe "Master::LabSpecimens", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/lab_specimens" do
    before do
      Master::LabSpecimen.create!(specimen_code: "100", name: "尿", category: "尿・便",
                                  recommended: true, display_order: 10)
      Master::LabSpecimen.create!(specimen_code: "101", name: "自然排尿", category: "尿・便",
                                  parent_specimen_code: "100", display_order: 20)
      Master::LabSpecimen.create!(specimen_code: "250", name: "血清", name_kana: "ケッセイ",
                                  category: "血液", recommended: true, display_order: 30)
    end

    it "掲載順で返し、分類・推奨・親コードで絞り込める" do
      get "/master/lab_specimens"
      expect(body["items"].map { |s| s["specimen_code"] }).to eq(%w[100 101 250])

      get "/master/lab_specimens", params: { category: "血液" }
      expect(body["items"].map { |s| s["specimen_code"] }).to eq(%w[250])

      get "/master/lab_specimens", params: { recommended: "true" }
      expect(body["items"].map { |s| s["specimen_code"] }).to eq(%w[100 250])

      get "/master/lab_specimens", params: { parent_specimen_code: "100" }
      expect(body["items"].map { |s| s["specimen_code"] }).to eq(%w[101])
    end

    it "名称・カナで検索できる" do
      get "/master/lab_specimens", params: { name: "けっせい" }
      expect(body["items"].map { |s| s["specimen_code"] }).to eq(%w[250])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/lab_specimens", params: { specimen_code: "100,250" }
      expect(body["items"].map { |s| s["specimen_code"] }).to match_array(%w[100 250])
    end
  end

  describe "GET /master/lab_specimens/categories" do
    it "検体分類を掲載順で返す" do
      Master::LabSpecimen.create!(specimen_code: "250", name: "血清", category: "血液", display_order: 30)
      Master::LabSpecimen.create!(specimen_code: "100", name: "尿", category: "尿・便", display_order: 10)

      get "/master/lab_specimens/categories"
      expect(body).to eq(["尿・便", "血液"])
    end
  end

  describe "CRUD" do
    it "作成・更新・削除できる" do
      post "/master/lab_specimens", params: {
        specimen_code: "800", name: "院内独自検体", short_name: "独自",
        default_container_code: "T01",
      }, as: :json
      expect(response).to have_http_status(:created)
      id = body["id"]

      patch "/master/lab_specimens/#{id}", params: { short_name: "独" }, as: :json
      expect(body["short_name"]).to eq("独")

      delete "/master/lab_specimens/#{id}"
      expect(response).to have_http_status(:no_content)
    end

    it "検体コードは3桁に限る" do
      post "/master/lab_specimens", params: { specimen_code: "80", name: "桁不足" }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "POST /master/lab_specimens/import" do
    it "xlsx を取り込んで件数を返す" do
      file = Rack::Test::UploadedFile.new(
        Rails.root.join("spec/fixtures/files/lab_specimens_sample.xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )

      post "/master/lab_specimens/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      expect(body["imported"]).to eq(5)
      expect(Master::LabSpecimen.count).to eq(5)
    end

    it "ファイル無しはエラー" do
      post "/master/lab_specimens/import"
      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
