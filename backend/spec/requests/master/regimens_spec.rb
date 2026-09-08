require "rails_helper"

RSpec.describe "Master::Regimens", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_regimen(code, name, **attrs)
    Master::Regimen.create!({ regimen_code: code, name: name }.merge(attrs))
  end

  let(:step_params) do
    [
      { name: "前投薬", days: "1", usage_type: "drip", route_code: "IV", infusion_minutes: 15,
        drugs: [
          { drug_role: "fluid", medicine_code: "641190009", dose_basis: "unit", dose_value: 1, dose_unit: "袋" },
          { drug_role: "antiemetic", medicine_code: "622356701", dose_basis: "fixed", dose_value: 0.75, dose_unit: "mg" },
        ] },
      { name: "オキサリプラチン", days: [1], usage_type: "drip", route_code: "IV", infusion_minutes: 120,
        drugs: [
          { drug_role: "anticancer", medicine_code: "622480401", dose_basis: "bsa", dose_value: 85, dose_unit: "mg" },
        ] },
      { name: "カペシタビン", days: [1], usage_type: "oral", usage_code: "1013044400000000", dose_days: 14,
        drugs: [
          { drug_role: "anticancer", medicine_code: "622200701", dose_basis: "bsa", dose_value: 1000, dose_unit: "mg" },
        ] },
    ]
  end

  describe "GET /master/regimens" do
    before do
      create_regimen("000001", "mFOLFOX6", name_kana: "エムフォルフォックス", department_code: "01", status: "approved",
                                            treatment_days: 3, rest_days: 11, display_order: 1)
      create_regimen("000002", "CapeOX", department_code: "02", status: "draft", display_order: 2)
      create_regimen("000003", "旧レジメン", status: "retired", display_order: 3,
                                    valid_from: Date.current - 100, valid_to: Date.current - 1)
      Master::RegimenStep.create!(regimen_code: "000002", usage_type: "drip", days: [1], display_order: 1).then do |step|
        Master::RegimenDrug.create!(regimen_code: "000002", step_id: step.id, drug_role: "anticancer",
                                    medicine_code: "622480401", dose_basis: "bsa", dose_value: 130)
      end
    end

    it "表示順で一覧を返し、1 クールの日数を添える" do
      get "/master/regimens"

      expect(body["items"].map { |i| i["regimen_code"] }).to eq(%w[000001 000002 000003])
      expect(body["items"][0]["cycle_days"]).to eq(14)
      expect(body["items"][0]).not_to have_key("search_name")
    end

    it "名称・カナで検索できる" do
      get "/master/regimens", params: { name: "ふぉるふぉっくす" }

      expect(body["items"].map { |i| i["regimen_code"] }).to eq(%w[000001])
    end

    it "診療科・状態・有効期間で絞れる" do
      get "/master/regimens", params: { department_code: "02" }
      expect(body["items"].map { |i| i["regimen_code"] }).to eq(%w[000002])

      get "/master/regimens", params: { status: "approved" }
      expect(body["items"].map { |i| i["regimen_code"] }).to eq(%w[000001])

      get "/master/regimens", params: { active: "true" }
      expect(body["items"].map { |i| i["regimen_code"] }).to eq(%w[000001 000002])
    end

    it "薬剤コードで「この薬剤を含むレジメン」を引ける" do
      get "/master/regimens", params: { medicine_code: "622480401" }

      expect(body["items"].map { |i| i["regimen_code"] }).to eq(%w[000002])
    end
  end

  describe "GET /master/regimens/:id" do
    let!(:regimen) { create_regimen("000001", "mFOLFOX6", treatment_days: 3, rest_days: 11) }

    before do
      Master::Medicine.create!(medicine_code: "622480401", name: "オキサリプラチン点滴静注液１００ｍｇ", unit_name: "瓶",
                               dosage_form: "4")
      Master::RegimenIndication.create!(regimen_code: "000001", management_number: "20066074", name: "結腸癌",
                                        icd10: "C189", display_order: 1)
      step = Master::RegimenStep.create!(regimen_code: "000001", name: "オキサリプラチン", usage_type: "drip",
                                         days: [1], route_code: "IV", infusion_minutes: 120, display_order: 1)
      Master::RegimenDrug.create!(regimen_code: "000001", step_id: step.id, drug_role: "anticancer",
                                  medicine_code: "622480401", dose_basis: "bsa", dose_value: 85, dose_unit: "mg")
      Master::RegimenLabCriterion.create!(regimen_code: "000001", category: "blood", analyte_code: "2A016",
                                          item_name: "好中球数", unit: "/μL", lower_limit: 1500)
      Master::RegimenAdverseEvent.create!(regimen_code: "000001", term: "末梢性感覚ニューロパチー", grade: 2)
      Master::RegimenStep.create!(regimen_code: "000001", name: "カペシタビン", usage_type: "oral", days: [1],
                                  usage_code: "1013044400000000", dose_days: 14, display_order: 2)
      Master::MedicineUsage.create!(usage_code: "1013044400000000", usage_name: "１日２回朝夕食後に服用",
                                    basic_usage_category_code: "1", basic_usage_category: "内服")
      # 別レジメンの子は混ざらない。
      Master::RegimenStep.create!(regimen_code: "000002", usage_type: "drip", days: [1])
    end

    it "コードでも引け、子を薬剤名付きで同梱する" do
      get "/master/regimens/000001"

      expect(body["name"]).to eq("mFOLFOX6")
      expect(body["cycle_days"]).to eq(14)
      expect(body["indications"].map { |i| i["name"] }).to eq(["結腸癌"])
      expect(body["steps"].size).to eq(2)
      expect(body["steps"][1]["usage"]["usage_name"]).to eq("１日２回朝夕食後に服用")
      expect(body["steps"][1]["usage"]["basic_usage_category"]).to eq("内服")
      drug = body["steps"][0]["drugs"][0]
      expect(drug["resolved_name"]).to eq("オキサリプラチン点滴静注液１００ｍｇ")
      expect(drug["resolved_unit_name"]).to eq("瓶")
      expect(drug["dose_value"]).to eq("85.0")
      expect(body["lab_criteria"][0]["analyte_code"]).to eq("2A016")
      expect(body["adverse_events"][0]["grade"]).to eq(2)
    end

    it "id でも引ける" do
      get "/master/regimens/#{regimen.id}"

      expect(body["regimen_code"]).to eq("000001")
    end
  end

  describe "POST /master/regimens" do
    it "コードを省略すると自動採番し、子を入れ子で保存する" do
      create_regimen("000012", "既存")

      post "/master/regimens", params: {
        name: "CapeOX", treatment_days: 14, rest_days: 7, planned_cycles: 8, status: "approved",
        indications: [{ management_number: "20066074", name: "結腸癌" }],
        steps: step_params,
        lab_criteria: [{ category: "renal", analyte_code: "C3002", item_name: "クレアチニン", upper_limit: 1.5 }],
        adverse_events: [{ term: "手足症候群", grade: 2, note: "保湿" }],
      }, as: :json

      expect(response).to have_http_status(:created)
      expect(body["regimen_code"]).to eq("000013")
      expect(body["cycle_days"]).to eq(21)
      steps = body["steps"]
      expect(steps.map { |s| s["display_order"] }).to eq([1, 2, 3])
      expect(steps[0]["days"]).to eq([1])
      expect(steps[0]["drugs"].map { |d| d["display_order"] }).to eq([1, 2])
      expect(steps[2]["usage_code"]).to eq("1013044400000000")
      expect(steps[2]["dose_days"]).to eq(14)
      expect(body["lab_criteria"].size).to eq(1)
      expect(body["adverse_events"][0]["note"]).to eq("保湿")
    end

    it "自動採番はサンプルの 9000xx 帯を数えない" do
      create_regimen("900010", "サンプル")

      post "/master/regimens", params: { name: "施設の 1 件目", treatment_days: 1, rest_days: 20 }, as: :json

      expect(response).to have_http_status(:created)
      expect(body["regimen_code"]).to eq("000001")
    end

    it "投与日は「1,8,15」の文字列でも受ける" do
      post "/master/regimens", params: {
        name: "週 1 回",
        steps: [{ usage_type: "drip", days: "1, 8,15", drugs: [] }],
      }, as: :json

      expect(response).to have_http_status(:created)
      expect(body["steps"][0]["days"]).to eq([1, 8, 15])
    end

    it "名称は必須" do
      post "/master/regimens", params: { note: "名称なし" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "検証に落ちた子があれば本体も登録されない" do
      post "/master/regimens", params: {
        name: "重複日",
        steps: [{ usage_type: "drip", days: [1, 1], drugs: [] }],
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("重複")
      expect(Master::Regimen.count).to eq(0)

      post "/master/regimens", params: {
        name: "上限が基準値未満",
        steps: [{ usage_type: "drip", days: [1],
                  drugs: [{ drug_role: "anticancer", medicine_code: "622480401", dose_basis: "fixed",
                            dose_value: 2, dose_max: 1 }] }],
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("基準値以上")
      expect(Master::Regimen.count).to eq(0)
    end

    it "有効終了日が有効開始日より前なら登録できない" do
      post "/master/regimens", params: { name: "期間おかしい", valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("有効開始日以降")
    end
  end

  describe "PUT /master/regimens/:id" do
    let!(:regimen) { create_regimen("000001", "mFOLFOX6", status: "draft") }

    before do
      step = Master::RegimenStep.create!(regimen_code: "000001", usage_type: "drip", days: [1], display_order: 1)
      Master::RegimenDrug.create!(regimen_code: "000001", step_id: step.id, drug_role: "anticancer",
                                  medicine_code: "622480401", dose_basis: "bsa", dose_value: 85)
      Master::RegimenAdverseEvent.create!(regimen_code: "000001", term: "消える副作用")
    end

    it "子の配列を丸ごと置き換え、送られなかった種別は触らない" do
      put "/master/regimens/000001", params: {
        name: "mFOLFOX6(改)", regimen_code: "999999",
        steps: [{ usage_type: "one-shot", days: [2], route_code: "IV",
                  drugs: [{ drug_role: "anticancer", medicine_code: "622210701", dose_basis: "bsa", dose_value: 400 }] }],
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(body["regimen_code"]).to eq("000001")
      expect(body["name"]).to eq("mFOLFOX6(改)")
      expect(body["steps"].size).to eq(1)
      expect(body["steps"][0]["usage_type"]).to eq("one-shot")
      expect(Master::RegimenDrug.where(regimen_code: "000001").pluck(:medicine_code)).to eq(%w[622210701])
      expect(body["adverse_events"].map { |a| a["term"] }).to eq(["消える副作用"])
    end
  end

  describe "PUT /master/regimens/:id(承認済の凍結)" do
    let!(:regimen) do
      create_regimen("000001", "mFOLFOX6", status: "approved", treatment_days: 3, rest_days: 11)
    end

    it "承認済は内容を変更できない" do
      put "/master/regimens/000001", params: { name: "直した名前" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("複製")
      expect(regimen.reload.name).to eq("mFOLFOX6")
    end

    it "承認済でも子は置き換えられない" do
      put "/master/regimens/000001", params: { adverse_events: [{ term: "後から足した" }] }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::RegimenAdverseEvent.count).to eq(0)
    end

    it "承認済でも廃止・有効期間は変えられる" do
      put "/master/regimens/000001", params: { status: "retired", valid_to: "2026-12-31" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(regimen.reload.status).to eq("retired")
      expect(regimen.valid_to.to_s).to eq("2026-12-31")
    end
  end

  describe "承認の記録" do
    it "承認したときに承認日をサーバーが入れ、下書きには戻せない" do
      create_regimen("000001", "mFOLFOX6", status: "draft", treatment_days: 3, rest_days: 11)
      step = Master::RegimenStep.create!(regimen_code: "000001", usage_type: "drip", days: [1], display_order: 1)
      Master::RegimenDrug.create!(regimen_code: "000001", step_id: step.id, drug_role: "anticancer",
                                  medicine_code: "622480401", dose_basis: "bsa", dose_value: 85, dose_unit: "mg")

      put "/master/regimens/000001", params: { status: "approved", approved_by: "practitioner-1" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(body["approved_on"]).to eq(Date.current.to_s)
      expect(body["approved_by"]).to eq("practitioner-1")

      # 下書きに戻せると「下書きにしてから直す」で凍結をすり抜けられる。
      put "/master/regimens/000001", params: { status: "draft" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("廃止")
      expect(Master::Regimen.find_by(regimen_code: "000001").status).to eq("approved")
    end
  end

  describe "内容の検証" do
    it "1 クールを超える投与日は保存できない" do
      post "/master/regimens", params: {
        name: "はみ出すレジメン", treatment_days: 3, rest_days: 11,
        steps: [{ name: "投与", days: [1, 20], usage_type: "drip",
                  drugs: [{ drug_role: "anticancer", medicine_code: "622480401", dose_basis: "bsa",
                            dose_value: 85, dose_unit: "mg" }] }],
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("1 クール")
      expect(Master::Regimen.count).to eq(0)
    end

    it "内服が 1 クールをはみ出すと保存できない" do
      post "/master/regimens", params: {
        name: "内服がはみ出す", treatment_days: 3, rest_days: 4,
        steps: [{ name: "内服", days: [1], usage_type: "oral", usage_code: "1013044400000000", dose_days: 14,
                  drugs: [{ drug_role: "anticancer", medicine_code: "622200701", dose_basis: "bsa",
                            dose_value: 1000, dose_unit: "mg" }] }],
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("はみ出します")
    end

    it "経過措置の医薬品を含むレジメンは承認できない(薬価基準の 99999999 は「なし」)" do
      Master::Medicine.create!(medicine_code: "622480401", name: "オキサリプラチン", unit_name: "瓶",
                               abolished_on: "99999999", transitional_measure_on: "20260331")
      create_regimen("000001", "経過措置入り", status: "draft", treatment_days: 3, rest_days: 11)
      step = Master::RegimenStep.create!(regimen_code: "000001", usage_type: "drip", days: [1], display_order: 1)
      Master::RegimenDrug.create!(regimen_code: "000001", step_id: step.id, drug_role: "anticancer",
                                  medicine_code: "622480401", dose_basis: "bsa", dose_value: 85, dose_unit: "mg")

      put "/master/regimens/000001", params: { status: "approved" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("2026-03-31 で経過措置")
      # 削除日の 99999999 は「なし」なので、削除のメッセージは出ない。
      expect(body["errors"].join).not_to include("削除された")
    end

    it "承認するときは基準値と単位を求める(下書きなら保存できる)" do
      params = {
        name: "書きかけ", treatment_days: 3, rest_days: 11,
        steps: [{ name: "投与", days: [1], usage_type: "drip",
                  drugs: [{ drug_role: "anticancer", medicine_code: "622480401", dose_basis: "bsa" }] }],
      }

      post "/master/regimens", params: params, as: :json
      expect(response).to have_http_status(:created)

      put "/master/regimens/#{body['regimen_code']}", params: { status: "approved" }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("基準値")
    end
  end

  describe "POST /master/regimens/:id/copy" do
    it "新しいコードで全部写し、承認は引き継がず下書きになる" do
      create_regimen("000001", "mFOLFOX6", status: "approved", approved_on: "2026-09-01", approved_by: "委員会",
                                            treatment_days: 3, rest_days: 11)
      step = Master::RegimenStep.create!(regimen_code: "000001", usage_type: "drip", days: [1], display_order: 1)
      Master::RegimenDrug.create!(regimen_code: "000001", step_id: step.id, drug_role: "anticancer",
                                  medicine_code: "622480401", dose_basis: "bsa", dose_value: 85)
      Master::RegimenIndication.create!(regimen_code: "000001", management_number: "20066074", name: "結腸癌")

      post "/master/regimens/000001/copy"

      expect(response).to have_http_status(:created)
      expect(body["regimen_code"]).to eq("000002")
      expect(body["name"]).to eq("mFOLFOX6のコピー")
      expect(body["status"]).to eq("draft")
      expect(body["approved_on"]).to be_nil
      expect(body["cycle_days"]).to eq(14)
      expect(body["indications"].size).to eq(1)
      expect(body["steps"][0]["drugs"][0]["medicine_code"]).to eq("622480401")
      expect(body["steps"][0]["drugs"][0]["step_id"]).not_to eq(step.id)
      # 改訂の系列を辿れるよう、複製元のコードを残す。
      expect(body["copied_from_code"]).to eq("000001")
    end
  end

  describe "DELETE /master/regimens/:id" do
    it "子も併せて片付ける" do
      create_regimen("000001", "mFOLFOX6")
      step = Master::RegimenStep.create!(regimen_code: "000001", usage_type: "drip", days: [1])
      Master::RegimenDrug.create!(regimen_code: "000001", step_id: step.id, drug_role: "anticancer",
                                  medicine_code: "622480401", dose_basis: "bsa", dose_value: 85)
      Master::RegimenLabCriterion.create!(regimen_code: "000001", category: "renal", item_name: "Cr")
      # 別レジメンのものは残る。
      Master::RegimenStep.create!(regimen_code: "000002", usage_type: "drip", days: [1])

      delete "/master/regimens/000001"

      expect(response).to have_http_status(:no_content)
      expect(Master::Regimen.count).to eq(0)
      expect(Master::RegimenStep.where(regimen_code: "000001").count).to eq(0)
      expect(Master::RegimenDrug.count).to eq(0)
      expect(Master::RegimenLabCriterion.count).to eq(0)
      expect(Master::RegimenStep.where(regimen_code: "000002").count).to eq(1)
    end

    it "承認済・廃止は削除できない" do
      create_regimen("000001", "mFOLFOX6", status: "approved")

      delete "/master/regimens/000001"

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("廃止")
      expect(Master::Regimen.count).to eq(1)
    end
  end
end
