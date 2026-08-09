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
        category_name: "生化学検査", major_item: "総蛋白(TP)",
        fhir_item_name: "総蛋白(TP)", abbreviation: "TP",
        jlac11_specimen: "血清", jlac11_method: "TP-L"
      )
      Master::LabItem.create!(
        jlac11_code: "C1000000000000002", jlac10_code: "3B035000002327201",
        category_name: "生化学検査", major_item: "AST(GOT)",
        fhir_item_name: "ＡＳＴ(ＧＯＴ)", abbreviation: "AST",
        jlac11_specimen: "血漿", jlac11_method: "AST-UV"
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

    it "major_item(大項目)・jlac11_specimen(材料)・jlac11_method(測定法)で絞り込む" do
      expect(names_for(major_item: "総蛋白(TP)")).to eq(["総蛋白(TP)"])
      expect(names_for(jlac11_specimen: "血漿")).to eq(["ＡＳＴ(ＧＯＴ)"])
      expect(names_for(jlac11_method: "TP-L")).to eq(["総蛋白(TP)"])
    end

    it "jlac11_code のカンマ区切りで複数指定できる" do
      expect(names_for(jlac11_code: "C1000000000000001,C1000000000000003"))
        .to eq(["総蛋白(TP)", "白血球数"])
    end

    it "jlac10_code のカンマ区切りで複数指定できる" do
      expect(names_for(jlac10_code: "3A010000002327101,3B035000002327201"))
        .to eq(["総蛋白(TP)", "ＡＳＴ(ＧＯＴ)"])
    end
  end

  describe "GET /master/lab_items (並び順)" do
    it "display_order の数値順に並べる(桁数が揃っていない値も正しく並ぶ)" do
      Master::LabItem.create!(jlac11_code: "C1", fhir_item_name: "三番目", display_order: "1000")
      Master::LabItem.create!(jlac11_code: "C2", fhir_item_name: "一番目", display_order: "100")
      Master::LabItem.create!(jlac11_code: "C3", fhir_item_name: "二番目", display_order: "200")

      get "/master/lab_items"

      expect(JSON.parse(response.body)["items"].map { |i| i["fhir_item_name"] })
        .to eq(%w[一番目 二番目 三番目])
    end

    it "display_order が同値なら収載順(id)で並べる" do
      Master::LabItem.create!(jlac11_code: "C1", fhir_item_name: "先", display_order: "100")
      Master::LabItem.create!(jlac11_code: "C2", fhir_item_name: "後", display_order: "100")

      get "/master/lab_items"

      expect(JSON.parse(response.body)["items"].map { |i| i["fhir_item_name"] }).to eq(%w[先 後])
    end
  end

  describe "GET /master/lab_items/filter_options" do
    before do
      Master::LabItem.create!(
        jlac11_code: "C1", category_name: "生化学検査", major_item: "総蛋白(TP)",
        fhir_item_name: "総蛋白(TP)", abbreviation: "TP",
        jlac11_specimen: "血清", jlac11_method: "TP-L"
      )
      Master::LabItem.create!(
        jlac11_code: "C2", category_name: "生化学検査", major_item: "総蛋白(TP)",
        fhir_item_name: "総蛋白(TP)", abbreviation: "TP",
        jlac11_specimen: "血漿", jlac11_method: "TP-P"
      )
      Master::LabItem.create!(
        jlac11_code: "C3", category_name: "生化学検査", major_item: "アルブミン",
        fhir_item_name: "アルブミン", abbreviation: "ALB",
        jlac11_specimen: "血清", jlac11_method: "ALB-BCP"
      )
      Master::LabItem.create!(
        jlac11_code: "C4", category_name: "血液学的検査", major_item: "血算-白血球数",
        fhir_item_name: "白血球数", abbreviation: "WBC",
        jlac11_specimen: "全血", jlac11_method: "フローサイトメトリー法"
      )
      Master::LabItem.create!(jlac11_code: "C5", category_name: "")
    end

    def options_for(params = {})
      get "/master/lab_items/filter_options", params: params
      JSON.parse(response.body)
    end

    it "区分名称は絞り込みに関係なく全件をマスタ収載順で返す" do
      body = options_for(category_name: "血液学的検査")

      expect(response).to have_http_status(:ok)
      expect(body["category_names"]).to eq(%w[生化学検査 血液学的検査])
    end

    it "大項目は区分名称で絞り込む" do
      expect(options_for["major_items"]).to eq(["総蛋白(TP)", "アルブミン", "血算-白血球数"])
      expect(options_for(category_name: "生化学検査")["major_items"])
        .to eq(["総蛋白(TP)", "アルブミン"])
    end

    it "大項目は名称検索(略称含む)でも絞り込む" do
      expect(options_for(name: "アルブミン")["major_items"]).to eq(["アルブミン"])
      expect(options_for(name: "wbc")["major_items"]).to eq(["血算-白血球数"])
    end

    it "配下の項目名称に現れない大項目名でもヒットする(かな・全半角の違いも吸収)" do
      Master::LabItem.create!(
        jlac11_code: "C6", category_name: "生化学検査", major_item: "グルコース(血糖)",
        fhir_item_name: "空腹時血糖", abbreviation: "FBG",
        jlac11_specimen: "血漿", jlac11_method: "ヘキソキナーゼ法"
      )

      expect(options_for(name: "ぐるこーす")["major_items"]).to eq(["グルコース(血糖)"])
    end

    it "名称検索は材料・測定法のリストには影響しない" do
      body = options_for(name: "アルブミン", category_name: "生化学検査")

      expect(body["specimens"]).to eq(%w[血清 血漿])
    end

    it "材料は大項目で、測定法は材料で絞り込む" do
      body = options_for(major_item: "総蛋白(TP)")
      expect(body["specimens"]).to eq(%w[血清 血漿])
      expect(body["methods"]).to eq(%w[TP-L TP-P])

      body = options_for(major_item: "総蛋白(TP)", jlac11_specimen: "血漿")
      expect(body["methods"]).to eq(%w[TP-P])
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
