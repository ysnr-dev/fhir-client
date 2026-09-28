require "rails_helper"

RSpec.describe "Master::FormularyGroups", type: :request do
  def body
    JSON.parse(response.body)
  end

  let!(:ppi) do
    Master::FormularyGroup.create!(code: "PPI", name: "プロトンポンプ阻害薬", yakko_codes: %w[2329], dosage_form: "1",
                                   display_order: 2)
  end
  let!(:antiemetic) do
    Master::FormularyGroup.create!(code: "ANTIEMETIC", name: "制吐薬", yakko_codes: %w[2391], dosage_form: "4",
                                   display_order: 1)
  end

  before do
    Master::Medicine.create!(medicine_code: "620000001", name: "ランソプラゾールＯＤ錠１５ｍｇ", unit_name: "錠",
                             dosage_form: "1", yakka_code: "2329023F1", generic_name_code: "2329023F1ZZZ")
    Master::Medicine.create!(medicine_code: "620000002", name: "エソメプラゾールカプセル２０ｍｇ", unit_name: "カプセル",
                             dosage_form: "1", yakka_code: "2329029M1")
    Master::Medicine.create!(medicine_code: "620000003", name: "オメプラゾール錠２０ｍｇ", unit_name: "錠",
                             dosage_form: "1", yakka_code: "2329022F1")
    Master::MedicineType.create!(code: "2329", name: "その他の消化性潰瘍用剤")
    ppi.entries.create!(medicine_code: "620000002", rank: 2, note: "嚥下困難なら OD 錠へ")
    ppi.entries.create!(medicine_code: "620000001", rank: 1)
  end

  describe "GET /master/formulary_groups" do
    it "群を表示順に、薬剤を順位順に医薬品名付きで返す" do
      get "/master/formulary_groups"

      expect(body.map { |g| g["code"] }).to eq(%w[ANTIEMETIC PPI])
      entries = body.last["entries"]
      expect(entries.map { |e| e.values_at("rank", "medicine_code", "medicine_name") }).to eq([
        [1, "620000001", "ランソプラゾールＯＤ錠１５ｍｇ"],
        [2, "620000002", "エソメプラゾールカプセル２０ｍｇ"],
      ])
      expect(entries.first).to include("medicine_unit_name" => "錠", "yakko_code" => "2329",
                                       "yakko_name" => "その他の消化性潰瘍用剤")
      expect(body.first["entries"]).to eq([])
    end

    it "剤形で絞れる" do
      get "/master/formulary_groups", params: { dosage_form: "4" }

      expect(body.map { |g| g["code"] }).to eq(%w[ANTIEMETIC])
    end
  end

  describe "POST /master/formulary_groups" do
    it "薬効分類の配列ごと登録できる" do
      post "/master/formulary_groups", params: { code: "STATIN", name: "スタチン", yakko_codes: %w[2189 ] }, as: :json

      expect(response).to have_http_status(:created)
      expect(Master::FormularyGroup.find_by(code: "STATIN").yakko_codes).to eq(%w[2189])
    end

    it "コードは重複できない" do
      post "/master/formulary_groups", params: { code: "PPI", name: "重複" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "DELETE /master/formulary_groups/:id" do
    it "薬剤ごと消える" do
      delete "/master/formulary_groups/#{ppi.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::FormularyEntry.where(formulary_group_id: ppi.id)).to be_empty
    end
  end

  describe "POST /master/formulary_entries" do
    it "順位を省くと群の末尾に付く" do
      post "/master/formulary_entries", params: { formulary_group_id: ppi.id, medicine_code: "620000003" }, as: :json

      expect(response).to have_http_status(:created)
      expect(body["rank"]).to eq(3)
    end

    it "同じ群に同じ薬は二度載せられない" do
      post "/master/formulary_entries", params: { formulary_group_id: ppi.id, medicine_code: "620000001" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "POST /master/formulary_entries/reorder" do
    it "ids の並びで順位を振り直す" do
      first, second = ppi.entries.to_a
      post "/master/formulary_entries/reorder", params: { ids: [second.id, first.id] }, as: :json

      expect(response).to have_http_status(:no_content)
      expect(ppi.entries.reload.map(&:medicine_code)).to eq(%w[620000002 620000001])
    end

    it "別の群の薬が混ざると 422" do
      other = antiemetic.entries.create!(medicine_code: "620000003", rank: 1)
      post "/master/formulary_entries/reorder", params: { ids: [ppi.entries.first.id, other.id] }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/medicines のフォーミュラリ列" do
    def items(params = {})
      get "/master/medicines", params: params
      body["items"]
    end

    it "載っている薬には順位と群名が付き、載っていない薬は空" do
      rows = items.index_by { |i| i["medicine_code"] }
      expect(rows["620000001"]).to include("formulary_rank" => 1, "formulary_group_name" => "プロトンポンプ阻害薬")
      expect(rows["620000003"]).to include("formulary_rank" => nil, "formulary_group_name" => nil)
    end

    it "一般名の行にも同じ一般名の銘柄の順位が付く" do
      Master::Medicine.create!(medicine_code: "620000004", name: "タケプロンＯＤ錠１５", dosage_form: "1",
                               yakka_code: "2329023F1", generic_name_code: "2329023F1ZZZ",
                               generic_name_description: "【般】ランソプラゾール口腔内崩壊錠１５ｍｇ")
      Master::Medicine.find_by(medicine_code: "620000001")
                      .update!(generic_name_description: "【般】ランソプラゾール口腔内崩壊錠１５ｍｇ")

      row = items(generic: "true").first
      expect(row).to include("generic" => true, "formulary_rank" => 1)
    end
  end
end
