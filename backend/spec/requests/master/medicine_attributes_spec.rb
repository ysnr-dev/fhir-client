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
    Master::Medicine.create!(medicine_code: "620000004", name: "メロペネム点滴静注用０．５ｇ", unit_name: "瓶",
                             dosage_form: "4", biological_product_flag: "0", yakka_code: "6139400F1024")
  end

  # ロット管理以外の項目の既定(行が無い・設定していない薬)。
  let(:other_defaults) do
    { "antimicrobial_category" => "none", "ddd" => nil, "adoption" => "unset", "no_crush" => false, "no_split" => false,
      "departments" => [] }
  end

  describe "GET /master/medicine_attributes/lookup" do
    it "行が無ければ医薬品マスタの生物学的製剤の印を既定にし、行の値があればそれを使う" do
      Master::MedicineAttribute.create!(medicine_code: "620000001", settings: { "lot_required" => true })
      Master::MedicineAttribute.create!(medicine_code: "620000003", settings: {})

      get "/master/medicine_attributes/lookup", params: { medicine_code: "620000001,620000002,620000003,999" }

      expect(body).to eq(
        "620000001" => { "lot_required" => true }.merge(other_defaults),
        "620000002" => { "lot_required" => true }.merge(other_defaults),
        "620000003" => { "lot_required" => false }.merge(other_defaults),
        "999" => { "lot_required" => false }.merge(other_defaults)
      )
    end

    it "明示の false で既定を外せる" do
      Master::MedicineAttribute.create!(medicine_code: "620000002", settings: { "lot_required" => false })

      get "/master/medicine_attributes/lookup", params: { medicine_code: "620000002" }

      expect(body).to eq("620000002" => { "lot_required" => false }.merge(other_defaults))
    end
  end

  describe "GET /master/medicine_attributes" do
    it "登録済みの行に医薬品名と実効値を添え、default=true で既定で対象の薬も並べる" do
      Master::MedicineAttribute.create!(medicine_code: "620000001", settings: { "lot_required" => true }, note: "血漿分画")

      get "/master/medicine_attributes", params: { default: "true" }

      expect(body["definitions"].map { |d| d.values_at("key", "type") }).to eq([
        %w[lot_required boolean], %w[antimicrobial_category enum], %w[ddd quantity], %w[adoption enum],
        %w[no_crush boolean], %w[no_split boolean], %w[departments departments]
      ])
      expect(body["definitions"][1]["options"].map { |o| o["value"] }).to eq(%w[none notify approve])
      expect(body["definitions"][2]["units"]).to eq(%w[g mg MU])
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
      expect(body["effective"]).to eq({ "lot_required" => true }.merge(other_defaults))
    end

    it "抗菌薬には特定抗菌薬の区分と DDD を保存でき、数値は文字列でも受け取る" do
      post "/master/medicine_attributes",
           params: { medicine_code: "620000004",
                     settings: { antimicrobial_category: "approve", ddd: { value: "3", unit: "g" } } },
           as: :json

      expect(response).to have_http_status(:created)
      expect(body["effective"]).to include("antimicrobial_category" => "approve", "ddd" => { "value" => 3.0, "unit" => "g" })
      expect(body["applicable"]).to eq("lot_required" => true, "antimicrobial_category" => true, "ddd" => true,
                                       "adoption" => true, "no_crush" => false, "no_split" => false,
                                       "departments" => true)
    end

    it "抗菌薬でない薬に特定抗菌薬の区分を保存すると 422" do
      post "/master/medicine_attributes", params: { medicine_code: "620000003", settings: { antimicrobial_category: "notify" } },
                                          as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "区分の値と DDD の単位は表の値だけ" do
      post "/master/medicine_attributes", params: { medicine_code: "620000004", settings: { antimicrobial_category: "yes" } },
                                          as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/master/medicine_attributes", params: { medicine_code: "620000004", settings: { ddd: { value: 2, unit: "mL" } } },
                                          as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "粉砕不可・分割不可は内用薬だけ" do
      Master::Medicine.create!(medicine_code: "610000001", name: "ニフェジピンＣＲ錠２０ｍｇ", unit_name: "錠",
                               dosage_form: "1")
      post "/master/medicine_attributes", params: { medicine_code: "610000001", settings: { no_crush: true } }, as: :json
      expect(response).to have_http_status(:created)

      post "/master/medicine_attributes", params: { medicine_code: "620000003", settings: { no_split: true } }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "処方できる診療科は科コードの並びで、空の並びは保存しない" do
      post "/master/medicine_attributes",
           params: { medicine_code: "620000003", settings: { departments: %w[01 13], adoption: "adopted" } }, as: :json
      expect(response).to have_http_status(:created)
      expect(body["effective"]).to include("departments" => %w[01 13], "adoption" => "adopted")

      patch "/master/medicine_attributes/#{body['id']}", params: { settings: { departments: [], adoption: "adopted" } },
                                                         as: :json
      expect(body["settings"]).to eq("adoption" => "adopted")

      post "/master/medicine_attributes", params: { medicine_code: "620000001", settings: { departments: ["内科"] } },
                                          as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "POST /master/medicine_attributes/import_adoption" do
    def csv_file(text, encoding: "UTF-8")
      Rack::Test::UploadedFile.new(StringIO.new(text.encode(encoding)), "text/csv", original_filename: "adoption.csv")
    end

    it "表示名か値で採用区分を書き、ほかの項目は残す。医薬品マスタに無いコードは数えて飛ばす" do
      Master::MedicineAttribute.create!(medicine_code: "620000002", settings: { "lot_required" => false })

      post "/master/medicine_attributes/import_adoption",
           params: { file: csv_file("医薬品コード,採用区分\n620000002,採用\n620000003,outpatient_only\n999,採用\n",
                                    encoding: "Windows-31J") }

      expect(body).to eq("imported" => 2, "skipped" => 1)
      expect(Master::MedicineAttribute.find_by(medicine_code: "620000002").settings)
        .to eq("lot_required" => false, "adoption" => "adopted")
      expect(Master::MedicineAttribute.find_by(medicine_code: "620000003").settings).to eq("adoption" => "outpatient_only")
    end

    it "読めない区分は 422 で、何も書かない" do
      post "/master/medicine_attributes/import_adoption",
           params: { file: csv_file("\uFEFFコード,区分\n620000002,採用\n620000003,常備\n") }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["error"]).to include("row 3")
      expect(Master::MedicineAttribute.count).to eq(0)
    end
  end
end
