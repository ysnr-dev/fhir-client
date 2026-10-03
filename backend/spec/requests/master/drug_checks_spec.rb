require "rails_helper"

RSpec.describe "Master drug checks", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "/master/drug_interactions" do
    let!(:warfarin) do
      Master::DrugInteraction.create!(code_a: "3332001", name_a: "ワルファリン", code_b: "1149", name_b: "その他の解熱鎮痛消炎剤",
                                      severity: "caution", note: "出血傾向")
    end

    it "全件を返し、文字で絞れる" do
      Master::DrugInteraction.create!(code_a: "2190021", name_a: "シルデナフィル", code_b: "2171", name_b: "硝酸薬",
                                      severity: "contraindicated")

      get "/master/drug_interactions"
      expect(body.size).to eq(2)

      get "/master/drug_interactions", params: { q: "ワルファリン" }
      expect(body.map { |r| r["id"] }).to eq([warfarin.id])
    end

    it "向きを入れ替えた同じ組み合わせは登録できない" do
      post "/master/drug_interactions",
           params: { code_a: "1149", name_a: "解熱鎮痛", code_b: "3332001", name_b: "ワルファリン", severity: "caution" },
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to include("同じ組み合わせが登録済みです")
    end

    it "コードは YJ の先頭 4〜7 桁" do
      post "/master/drug_interactions",
           params: { code_a: "33", name_a: "x", code_b: "1149019F1560", name_b: "y", severity: "caution" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "/master/drug_dose_rules" do
    it "上限つきの規則を登録できる" do
      post "/master/drug_dose_rules",
           params: { code: "1149019", name: "ロキソプロフェン", max_daily_dose: 180, dose_unit: "mg", severity: "caution" },
           as: :json

      expect(response).to have_http_status(:created)
      get "/master/drug_dose_rules"
      expect(body.first).to include("code" => "1149019", "max_daily_dose" => "180.0", "per_kg" => false)
    end

    it "腎機能の条件は指標としきい値をそろえる" do
      post "/master/drug_dose_rules",
           params: { code: "3969010", name: "メトホルミン", renal_index: "egfr", severity: "contraindicated",
                     message: "eGFR 30 未満は禁忌" },
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "条件も上限も無い規則は登録できない" do
      post "/master/drug_dose_rules",
           params: { code: "3969010", name: "メトホルミン", severity: "caution", message: "注意" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "上限の無い規則は文言が要る" do
      post "/master/drug_dose_rules",
           params: { code: "3969010", name: "メトホルミン", renal_index: "egfr", renal_below: 30,
                     severity: "contraindicated" },
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
