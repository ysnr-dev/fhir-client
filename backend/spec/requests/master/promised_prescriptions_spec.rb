require "rails_helper"

RSpec.describe "Master::PromisedPrescriptions", type: :request do
  def body
    JSON.parse(response.body)
  end

  before do
    Master::Medicine.create!(medicine_code: "620000001", name: "ヘパリン類似物質油性クリーム０．３％", unit_name: "ｇ",
                             dosage_form: "6")
    Master::Medicine.create!(medicine_code: "620000002", name: "ベタメタゾン吉草酸エステル軟膏０．１２％", unit_name: "ｇ",
                             dosage_form: "6")
  end

  let!(:ointment) do
    Master::PromisedPrescription.create!(
      code: "000001", name: "混合軟膏Ａ", name_kana: "コンゴウナンコウエー", base_amount: 50, unit_name: "ｇ", mix: true,
      display_order: 2,
      items: [
        Master::PromisedPrescriptionItem.new(medicine_code: "620000001", amount: 25, unit_name: "ｇ", display_order: 1),
        Master::PromisedPrescriptionItem.new(medicine_code: "620000009", amount: 25, unit_name: "ｇ", display_order: 2),
      ],
    )
  end
  let!(:expired) do
    Master::PromisedPrescription.create!(code: "000002", name: "旧うがい薬", base_amount: 1, unit_name: "本",
                                         display_order: 1, valid_to: FacilityClock.today - 1)
  end

  describe "GET /master/promised_prescriptions" do
    it "表示順に、構成薬を医薬品名付きで返す" do
      get "/master/promised_prescriptions"

      expect(body["total"]).to eq(2)
      expect(body["items"].map { |p| p["code"] }).to eq(%w[000002 000001])
      items = body["items"].last["items"]
      expect(items.map { |i| i.values_at("medicine_code", "medicine_name", "amount", "unit_name") }).to eq([
        ["620000001", "ヘパリン類似物質油性クリーム０．３％", "25.0", "ｇ"],
        ["620000009", nil, "25.0", "ｇ"],
      ])
      expect(body["items"].first["items"]).to eq([])
    end

    it "active=true は有効期間内だけ" do
      get "/master/promised_prescriptions", params: { active: "true" }

      expect(body["items"].map { |p| p["code"] }).to eq(%w[000001])
    end

    it "名称とカナで検索できる" do
      get "/master/promised_prescriptions", params: { name: "こんごう" }

      expect(body["items"].map { |p| p["code"] }).to eq(%w[000001])
    end
  end

  describe "GET /master/promised_prescriptions/:id" do
    it "構成薬ごと返す" do
      get "/master/promised_prescriptions/#{ointment.id}"

      expect(body).to include("name" => "混合軟膏Ａ", "mix" => true)
      expect(body["items"].size).to eq(2)
    end
  end

  describe "POST /master/promised_prescriptions" do
    it "コードを省くと採番し、構成薬を並び順どおりに登録する" do
      post "/master/promised_prescriptions", params: {
        name: "混合軟膏Ｂ", base_amount: 100, unit_name: "ｇ",
        items: [
          { medicine_code: "620000002", amount: 30, unit_name: "ｇ" },
          { medicine_code: "620000001", amount: 70, unit_name: "ｇ" },
        ],
      }, as: :json

      expect(response).to have_http_status(:created)
      expect(body["code"]).to eq("000003")
      expect(body["items"].map { |i| i["medicine_code"] }).to eq(%w[620000002 620000001])
    end

    it "名称・基準量・単位が要る" do
      post "/master/promised_prescriptions", params: { name: "", base_amount: 0 }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].size).to be >= 3
    end

    it "同じ医薬品は二度登録できず、量は 0 より大きい" do
      post "/master/promised_prescriptions", params: {
        name: "重複", base_amount: 10, unit_name: "ｇ",
        items: [
          { medicine_code: "620000001", amount: 5 },
          { medicine_code: "620000001", amount: 0 },
        ],
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::PromisedPrescription.find_by(name: "重複")).to be_nil
    end
  end

  describe "PATCH /master/promised_prescriptions/:id" do
    it "items を渡すと構成薬を差し替える" do
      patch "/master/promised_prescriptions/#{ointment.id}", params: {
        base_amount: 100,
        items: [
          { medicine_code: "620000001", amount: 60, unit_name: "ｇ" },
          { medicine_code: "620000002", amount: 40, unit_name: "ｇ" },
        ],
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(body["items"].map { |i| i.values_at("medicine_code", "amount") }).to eq([
        %w[620000001 60.0], %w[620000002 40.0],
      ])
      expect(Master::PromisedPrescriptionItem.where(promised_prescription_id: ointment.id).count).to eq(2)
    end

    it "items を渡さなければ構成薬は変わらない" do
      patch "/master/promised_prescriptions/#{ointment.id}", params: { name: "混合軟膏Ａ改" }, as: :json

      expect(body["name"]).to eq("混合軟膏Ａ改")
      expect(body["items"].size).to eq(2)
    end

    it "終了日は開始日より前にできない" do
      patch "/master/promised_prescriptions/#{ointment.id}",
            params: { valid_from: "2026-11-10", valid_to: "2026-11-01" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "DELETE /master/promised_prescriptions/:id" do
    it "構成薬ごと消える" do
      delete "/master/promised_prescriptions/#{ointment.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::PromisedPrescriptionItem.where(promised_prescription_id: ointment.id)).to be_empty
    end
  end
end
