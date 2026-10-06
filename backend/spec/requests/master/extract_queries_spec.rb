require "rails_helper"

RSpec.describe "Master::ExtractQueries", type: :request do
  def body = JSON.parse(response.body)

  let(:hba1c) { [{ "system" => "http://fhir-client.local/CodeSystem/lab-result-item", "code" => "160010010" }] }
  let(:dm) { [{ "system" => "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/ICD10-2013-full", "code" => "E11" }] }

  def definition(root)
    { "schema_version" => 1, "root" => root }
  end

  let(:valid_root) do
    {
      "op" => "and",
      "children" => [
        { "key" => "c1", "kind" => "condition", "codes" => dm, "clinical_status" => ["active"] },
        { "key" => "c2", "kind" => "observation", "not" => true, "codes" => hba1c,
          "period" => { "mode" => "relative", "days" => 90 } },
        { "op" => "or", "children" => [
          { "key" => "c3", "kind" => "patient", "age" => { "min" => 75 } },
          { "key" => "c4", "kind" => "observation", "codes" => hba1c,
            "value" => { "op" => "ge", "value" => 8.0 } }
        ] }
      ]
    }
  end

  def create_query(root, scope: "facility", owner_id: nil, name: "抽出")
    post "/master/extract_queries",
         params: { scope: scope, owner_id: owner_id, name: name, definition: definition(root) }, as: :json
  end

  def errors_text = body["errors"].to_s

  describe "POST /master/extract_queries" do
    it "入れ子の条件を保存して返す" do
      create_query(valid_root)
      expect(response).to have_http_status(:created)
      expect(body["definition"]["root"]["children"].size).to eq(3)
      expect(body["code"]).to be_present
    end

    it "OR の下に除外の条件は置けない" do
      root = { "op" => "or", "children" => [
        { "key" => "a", "kind" => "condition", "codes" => dm },
        { "key" => "b", "kind" => "observation", "codes" => hba1c, "not" => true }
      ] }
      create_query(root)
      expect(response).to have_http_status(:unprocessable_content)
      expect(errors_text).to include("OR の下には除外")
    end

    it "除外だけの AND は置けない" do
      create_query({ "op" => "and", "children" => [{ "key" => "a", "kind" => "condition", "codes" => dm, "not" => true }] })
      expect(errors_text).to include("除外でない条件")
    end

    it "深さ 3 を超える入れ子は弾く" do
      deep = { "op" => "and", "children" => [
        { "op" => "or", "children" => [
          { "op" => "and", "children" => [{ "key" => "a", "kind" => "condition", "codes" => dm }] }
        ] }
      ] }
      create_query(deep)
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "種類ごとの必須項目を確かめる" do
      create_query({ "op" => "and", "children" => [
        { "key" => "a", "kind" => "observation" },
        { "key" => "b", "kind" => "admission" },
        { "key" => "c", "kind" => "patient" }
      ] })
      expect(errors_text).to include("codes は 1 件以上")
      expect(errors_text).to include("period は必須")
      expect(errors_text).to include("性別か年齢")
    end

    it "相対の期間は日数、絶対の期間は from か to が要る" do
      create_query({ "op" => "and", "children" => [
        { "key" => "a", "kind" => "outpatient", "period" => { "mode" => "relative" } },
        { "key" => "b", "kind" => "outpatient", "period" => { "mode" => "absolute" } }
      ] })
      expect(errors_text).to include("days は必須")
      expect(errors_text).to include("from か to")
    end

    it "条件の key の重なりと未知の種類を弾く" do
      create_query({ "op" => "and", "children" => [
        { "key" => "a", "kind" => "condition", "codes" => dm },
        { "key" => "a", "kind" => "procedure", "codes" => dm }
      ] })
      expect(errors_text).to include("key が重なって")
      expect(errors_text).to include("kind")
    end

    it "処方・注射は薬効分類だけでも指定でき、処方 / 注射を分けられる" do
      create_query({ "op" => "and", "children" => [
        { "key" => "a", "kind" => "medication", "order_type" => "injection", "min_count" => 2,
          "drug_classes" => [{ "code" => "61", "name" => "抗生物質製剤" }] }
      ] })
      expect(response).to have_http_status(:created)

      create_query({ "op" => "and", "children" => [
        { "key" => "a", "kind" => "medication", "order_type" => "tablet", "drug_classes" => [{ "code" => "6" }] }
      ] }, name: "誤り")
      expect(errors_text).to include("order_type")
      expect(errors_text).to include("2〜4 桁")
    end

    it "時間関係は同じ AND グループの、除外でも時間関係でもない条件を基準にできる" do
      dis = { "key" => "dis", "kind" => "admission", "date_mode" => "discharged", "period" => { "mode" => "relative", "days" => 365 } }
      re = { "key" => "re", "kind" => "admission", "period" => { "mode" => "relative", "days" => 365 },
             "relation" => { "key" => "dis", "from_days" => 1, "to_days" => 30, "anchor_date" => "end" } }
      create_query({ "op" => "and", "children" => [dis, re] })
      expect(response).to have_http_status(:created)

      create_query({ "op" => "or", "children" => [dis, re] }, name: "OR")
      expect(errors_text).to include("OR の下には時間関係")

      create_query({ "op" => "and", "children" => [dis.merge("not" => true), re] }, name: "除外が基準")
      expect(errors_text).to include("基準が同じグループの条件ではありません")

      create_query({ "op" => "and", "children" => [dis, re.merge("relation" => re["relation"].merge("key" => "none"))] },
                   name: "基準なし")
      expect(errors_text).to include("基準が同じグループの条件ではありません")

      create_query({ "op" => "and", "children" => [dis, re.merge("relation" => re["relation"].merge("from_days" => 40))] },
                   name: "逆")
      expect(errors_text).to include("from_days を to_days 以下")
    end

    it "グループに条件の項目は置けない" do
      create_query({ "op" => "and", "children" => [
        { "op" => "or", "kind" => "condition", "children" => [{ "key" => "a", "kind" => "condition", "codes" => dm }] }
      ] })
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/extract_queries" do
    before do
      ExtractQuery.create!(scope: "facility", name: "共通", definition: definition(valid_root))
      ExtractQuery.create!(scope: "department", owner_id: "dept-1", name: "内科", definition: definition(valid_root))
      ExtractQuery.create!(scope: "practitioner", owner_id: "prac-1", name: "自分", definition: definition(valid_root))
      ExtractQuery.create!(scope: "practitioner", owner_id: "prac-2", name: "他人", definition: definition(valid_root))
    end

    it "院内共通 + 指定した診療科 + 指定した医師だけを返す" do
      get "/master/extract_queries", params: { department_id: "dept-1", practitioner_id: "prac-1" }
      expect(body["items"].map { |i| i["name"] }).to contain_exactly("共通", "内科", "自分")
    end
  end

  describe "実行の記録" do
    let!(:query) { ExtractQuery.create!(scope: "facility", name: "共通", definition: definition(valid_root)) }

    it "人数と条件ごとの人数を残し、新しい順に返す。条件を消すと一緒に消える" do
      post "/master/extract_queries/#{query.id}/runs",
           params: { patient_count: 3, leaf_counts: { c1: 4, c2: 1 }, ran_by_name: "医師 一郎" }, as: :json
      expect(response).to have_http_status(:created)
      travel 1.minute do
        post "/master/extract_queries/#{query.id}/runs", params: { patient_count: 5, leaf_counts: { c1: 6 } }, as: :json
      end

      get "/master/extract_queries/#{query.id}/runs"
      expect(body["items"].map { |r| r["patient_count"] }).to eq([5, 3])
      expect(body["items"].last["leaf_counts"]).to eq("c1" => 4, "c2" => 1)

      delete "/master/extract_queries/#{query.id}"
      expect(ExtractQueryRun.count).to eq(0)
    end

    it "人数は 0 以上の整数" do
      post "/master/extract_queries/#{query.id}/runs", params: { patient_count: -1, leaf_counts: { c1: "x" } }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "プリセット" do
    it "同梱の条件はどれも形の検証を通り、2 度流しても増えない" do
      path = Rails.root.join("db/seed_data/extract_query_presets.json")
      first = ExtractQueryPresets.load!(path)
      second = ExtractQueryPresets.load!(path)
      expect(first.created).to eq(JSON.parse(File.read(path)).size)
      expect(second.created).to eq(0)
    end
  end
end
