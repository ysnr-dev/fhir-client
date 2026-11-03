require "rails_helper"

RSpec.describe "Master::Bom*", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "POST /master/bom_outcomes/import" do
    it "見出しの合うシートをすべて読み、アウトカムは重複を除き、OAT の組を別に持つ" do
      post "/master/bom_outcomes/import", params: { file: fixture_file_upload("bom_sample.xlsx") }

      expect(response).to have_http_status(:ok)
      # 本体シートの 2 件 + Others の新規 1 件(同じコードは本体の行を残す)。
      expect(body["imported"]).to eq(3)
      outcome = Master::BomOutcome.find_by(outcome_code: "O01390")
      expect(outcome.outcome_name).to eq("循環動態が安定している")
      expect(outcome.subcategory_code).to eq("H013")
      expect(outcome.category_code).to eq("H")
      expect(Master::BomOutcome.find_by(outcome_code: "O03140").subcategory_name).to eq("女性器・生殖器・乳腺")
      # 組: 本体 3 + Others の 1(観察項目の無い新規アウトカムの行は組にしない)。
      expect(Master::BomPair.count).to eq(4)
      expect(Master::BomPair.where(outcome_code: "O01390").order(:display_order).pluck(:assessment_code))
        .to eq(%w[1900034303 1900034304 3400145000])
    end

    it "必須の列が無ければ 422" do
      file = Rack::Test::UploadedFile.new(StringIO.new("管理番号,名称\n1,x\n"), "text/csv", original_filename: "x.csv")
      post "/master/bom_outcomes/import", params: { file: file }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["error"]).to include("アウトカムコード")
    end

    it "Shift_JIS の CSV も読み、「－」は空にする" do
      text = "アウトカムコード,アウトカム名称,中分類コード\nO1,疼痛が自制内である,－\n".encode("CP932")
      file = Rack::Test::UploadedFile.new(StringIO.new(text), "text/csv", original_filename: "bom.csv")
      post "/master/bom_outcomes/import", params: { file: file }

      expect(response).to have_http_status(:ok)
      outcome = Master::BomOutcome.find_by(outcome_code: "O1")
      expect(outcome.outcome_name).to eq("疼痛が自制内である")
      expect(outcome.subcategory_code).to be_nil
    end
  end

  describe "POST /master/bom_assessments/import" do
    it "観察項目を取り込み、MEDIS の管理番号を持つ" do
      post "/master/bom_assessments/import", params: { file: fixture_file_upload("bom_assessments_sample.csv") }

      expect(response).to have_http_status(:ok)
      expect(body["imported"]).to eq(2)
      item = Master::BomAssessment.find_by(assessment_code: "1900034303")
      expect(item.name).to eq("脈拍数【適正値：≧110回/分】")
      expect(item.category_code).to eq("19")
      expect(item.medis_manage_no).to eq("31001390")
    end

    it "配布 Excel では観察項目マスターの行を優先し、Others の追加分と組み合わせだけの項目も読む" do
      post "/master/bom_assessments/import", params: { file: fixture_file_upload("bom_sample.xlsx") }

      expect(response).to have_http_status(:ok)
      # 観察項目マスター 2 件 + Others 1 件 + 本体の組み合わせにしか無い 1 件。同じコードは分類を持つマスターの行を残す。
      expect(body["imported"]).to eq(4)
      expect(Master::BomAssessment.find_by(assessment_code: "3400145000").category_name).to eq("呼吸")
      expect(Master::BomAssessment.find_by(assessment_code: "1900034304").medis_manage_no).to eq("31001848")
      expect(Master::BomAssessment.find_by(assessment_code: "1900034303").category_code).to eq("19")
      expect(Master::BomAssessment.find_by(assessment_code: "3400063200").category_code).to be_nil
    end
  end

  describe "GET /master/bom_outcomes, /master/bom_assessments" do
    before do
      Master::BomOutcome.create!(outcome_code: "O01390", outcome_name: "循環動態が安定している", category_code: "H",
                                 subcategory_code: "H013", display_order: 1)
      Master::BomOutcome.create!(outcome_code: "O00470", outcome_name: "身体的準備ができている", category_code: "G",
                                 display_order: 2)
      Master::BomAssessment.create!(assessment_code: "1900034303", name: "脈拍数", category_code: "19", display_order: 1)
      Master::BomPair.create!(outcome_code: "O01390", assessment_code: "1900034303", display_order: 1)
      Master::BomPair.create!(outcome_code: "O01390", assessment_code: "9999999999", assessment_name: "マスタに無い項目",
                              display_order: 2)
    end

    it "アウトカムの観察項目(OAT の組)を、マスタの行があればその内容で返す" do
      get "/master/bom_outcomes/O01390/assessments"

      items = body["items"]
      expect(items.map { |i| i["assessment_code"] }).to eq(%w[1900034303 9999999999])
      expect(items[0]["category_code"]).to eq("19")
      expect(items[1]["name"]).to eq("マスタに無い項目")
    end

    it "名称の部分一致・分類・コードで引ける" do
      get "/master/bom_outcomes", params: { name: "循環" }
      expect(body["items"].map { |i| i["outcome_code"] }).to eq(["O01390"])

      get "/master/bom_outcomes", params: { category_code: "G" }
      expect(body["items"].map { |i| i["outcome_code"] }).to eq(["O00470"])

      get "/master/bom_assessments", params: { code: "1900034303" }
      expect(body["items"].first["name"]).to eq("脈拍数")
    end
  end
end
