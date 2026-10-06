require "rails_helper"

RSpec.describe "Master::MedicineAttributes", type: :request do
  def body = JSON.parse(response.body)

  before do
    Master::Medicine.create!(medicine_code: "620000001", name: "献血アルブミン２５％静注", unit_name: "瓶",
                             dosage_form: "4", biological_product_flag: "0")
    Master::Medicine.create!(medicine_code: "620000002", name: "ビームゲン注０．５ｍＬ", unit_name: "瓶",
                             dosage_form: "4", biological_product_flag: "1")
    Master::Medicine.create!(medicine_code: "620000003", name: "生理食塩液", unit_name: "瓶",
                             dosage_form: "4", biological_product_flag: "0")
  end

  describe "GET /master/medicine_attributes/lookup" do
    it "行が無ければ医薬品マスタの生物学的製剤の印を既定にし、行の値があればそれを使う" do
      Master::MedicineAttribute.create!(medicine_code: "620000001", settings: { "lot_required" => true })
      Master::MedicineAttribute.create!(medicine_code: "620000003", settings: {})

      get "/master/medicine_attributes/lookup", params: { medicine_code: "620000001,620000002,620000003,999" }

      expect(body).to eq(
        "620000001" => { "lot_required" => true },
        "620000002" => { "lot_required" => true },
        "620000003" => { "lot_required" => false },
        "999" => { "lot_required" => false }
      )
    end

    it "明示の false で既定を外せる" do
      Master::MedicineAttribute.create!(medicine_code: "620000002", settings: { "lot_required" => false })

      get "/master/medicine_attributes/lookup", params: { medicine_code: "620000002" }

      expect(body).to eq("620000002" => { "lot_required" => false })
    end
  end

  describe "GET /master/medicine_attributes" do
    it "登録済みの行に医薬品名と実効値を添え、default=true で既定で対象の薬も並べる" do
      Master::MedicineAttribute.create!(medicine_code: "620000001", settings: { "lot_required" => true }, note: "血漿分画")

      get "/master/medicine_attributes", params: { default: "true" }

      expect(body["definitions"]).to eq([{ "key" => "lot_required", "label" => "ロット管理", "type" => "boolean" }])
      expect(body["items"].map { |i| i.values_at("medicine_code", "medicine_name", "registered") }).to eq([
        ["620000001", "献血アルブミン２５％静注", true],
        ["620000002", "ビームゲン注０．５ｍＬ", false],
      ])
      expect(body["items"].map { |i| i["effective"]["lot_required"] }).to eq([true, true])
    end
  end

  describe "POST /master/medicine_attributes" do
    it "項目の表に無いキーと、形の違う値は 422" do
      post "/master/medicine_attributes", params: { medicine_code: "620000003", settings: { bogus: true } }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/master/medicine_attributes", params: { medicine_code: "620000003", settings: { lot_required: "yes" } },
                                          as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "同じ薬は 2 行にできない" do
      Master::MedicineAttribute.create!(medicine_code: "620000003")
      post "/master/medicine_attributes", params: { medicine_code: "620000003" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "null の項目は保存せず既定に戻す" do
      post "/master/medicine_attributes", params: { medicine_code: "620000002", settings: { lot_required: nil } },
                                          as: :json

      expect(response).to have_http_status(:created)
      expect(body["settings"]).to eq({})
      expect(body["effective"]).to eq("lot_required" => true)
    end
  end
end
