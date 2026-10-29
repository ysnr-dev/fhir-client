require "rails_helper"

RSpec.describe "Master::ManagementFeeItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_item(code, overrides = {})
    Master::ManagementFeeItem.create!({ item_code: code, name: "項目#{code}", receipt_code: "113001810" }.merge(overrides))
  end

  describe "GET /master/management_fee_items" do
    before do
      create_item("M0001", name: "特定疾患療養管理料", name_kana: "トクテイシッカンリョウヨウカンリリョウ",
                           display_order: 20)
      create_item("M0002", name: "生活習慣病管理料２", receipt_code: "113707110", display_order: 10, inpatient: false)
      create_item("M0003", name: "旧項目", active: false, display_order: 30)
    end

    it "表示順で返す" do
      get "/master/management_fee_items"
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[M0002 M0001 M0003])
    end

    it "有効なものだけ・入外区分で絞り込める" do
      get "/master/management_fee_items", params: { active: "true", setting: "inpatient" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[M0001])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/management_fee_items", params: { item_code: "M0001,M0003" }
      expect(body["items"].map { |i| i["item_code"] }).to match_array(%w[M0001 M0003])
    end

    it "名称・カナで検索できる" do
      get "/master/management_fee_items", params: { name: "とくていしっかん" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[M0001])
    end

    it "診療行為マスタの名称・点数・上限と、加算の名称・点数を添える" do
      Master::MedicalProcedure.create!(procedure_code: "113001810", name: "特定疾患療養管理料（診療所）",
                                       points: 225, max_times: "2")
      Master::MedicalProcedure.create!(procedure_code: "113034170", name: "外来管理加算的な加算", points: 52)
      create_item("M0010", addition_codes: %w[113034170 199999999])

      get "/master/management_fee_items", params: { item_code: "M0010" }

      item = body["items"].first
      expect(item["receipt_procedure_name"]).to eq("特定疾患療養管理料（診療所）")
      expect(item["receipt_points"].to_f).to eq(225)
      expect(item["receipt_max_times"]).to eq("2")
      expect(item["additions"].map { |a| [a["code"], a["name"]] })
        .to eq([%w[113034170 外来管理加算的な加算], ["199999999", nil]])
    end
  end

  describe "POST /master/management_fee_items" do
    it "項目コードを省略すると自動採番し、加算コードを保存する" do
      create_item("000004")

      post "/master/management_fee_items", params: { name: "生活習慣病管理料１", receipt_code: "113041910",
                                                     addition_codes: %w[113010370], monthly_limit: 1 },
                                           as: :json

      expect(response).to have_http_status(:created)
      expect(body["item_code"]).to eq("000005")
      expect(body["addition_codes"]).to eq(%w[113010370])
      expect(body["monthly_limit"]).to eq(1)
    end

    it "レセ電算コード・加算コードの形が違えば 422" do
      post "/master/management_fee_items", params: { name: "x", receipt_code: "12345" }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/master/management_fee_items", params: { name: "x", receipt_code: "113001810",
                                                     addition_codes: %w[abc] }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "入院・外来のどちらでも算定できない項目は 422" do
      post "/master/management_fee_items", params: { name: "x", receipt_code: "113001810",
                                                     inpatient: false, outpatient: false }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH / DELETE /master/management_fee_items/:id" do
    it "コードで引いて更新・削除できる" do
      create_item("M0001", addition_codes: %w[113010370])

      patch "/master/management_fee_items/M0001", params: { addition_codes: [], monthly_limit: nil }, as: :json
      expect(response).to have_http_status(:ok)
      expect(body["addition_codes"]).to eq([])

      delete "/master/management_fee_items/M0001"
      expect(response).to have_http_status(:no_content)
      expect(Master::ManagementFeeItem.count).to eq(0)
    end
  end
end
