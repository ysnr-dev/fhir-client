require "rails_helper"

RSpec.describe "Master::NursingActs", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_act(manage_no, l1, l2, l3, l4, overrides = {})
    Master::NursingAct.create!({
      manage_no: manage_no, level1_code: l1, level1_name: "L1#{l1}", level2_code: l2, level2_name: "L2#{l2}",
      level3_code: l3, level3_name: "行為#{l3}", level4_code: l4, level4_name: "",
      code_16: "#{l1}#{l2}#{l3}#{l4}", active: true, sort_key: manage_no.to_i,
      search_name: Master::SearchNormalizer.normalize("行為#{l3}")
    }.merge(overrides))
  end

  before do
    create_act("1", "A001", "B001", "C001", "D000")
    create_act("2", "A001", "B001", "C001", "D001", level4_name: "全介助",
                                                  search_name: Master::SearchNormalizer.normalize("行為C001全介助"))
    create_act("3", "A001", "B002", "C010", "D000")
    create_act("4", "A002", "B020", "C100", "D000", active: false)
  end

  describe "GET /master/nursing_acts" do
    it "既定は有効な用語だけをソートキー順で返す" do
      get "/master/nursing_acts"
      expect(body["items"].map { |i| i["manage_no"] }).to eq(%w[1 2 3])
    end

    it "active=false で削除済みも返す" do
      get "/master/nursing_acts", params: { active: "false" }
      expect(body["total"]).to eq(4)
    end

    it "階層で絞り込める" do
      get "/master/nursing_acts", params: { level1_code: "A001", level2_code: "B002" }
      expect(body["items"].map { |i| i["manage_no"] }).to eq(%w[3])
    end

    it "名称で検索できる" do
      get "/master/nursing_acts", params: { name: "全介助" }
      expect(body["items"].map { |i| i["manage_no"] }).to eq(%w[2])
    end

    it "管理番号のカンマ区切りで一括取得できる" do
      get "/master/nursing_acts", params: { manage_no: "1,3" }
      expect(body["items"].map { |i| i["manage_no"] }).to match_array(%w[1 3])
    end
  end

  describe "GET /master/nursing_acts/levels" do
    it "有効な用語の第 1・第 2 階層を返す" do
      get "/master/nursing_acts/levels"
      levels = body["levels"]
      expect(levels.map { |l| l["code"] }).to eq(%w[A001])
      expect(levels[0]["children"].map { |c| c["code"] }).to eq(%w[B001 B002])
      expect(levels[0]["children"][0]["name"]).to eq("L2B001")
    end
  end

  describe "GET /master/nursing_acts/actions" do
    it "行為(第 3 階層)ごとに畳んで修飾語の数を返す" do
      get "/master/nursing_acts/actions"
      items = body["items"]
      expect(body["total"]).to eq(2)
      expect(items.map { |i| i["level3_code"] }).to eq(%w[C001 C010])
      expect(items[0]["modifier_count"]).to eq(2)
      # 修飾語なし(D000)を既定にする
      expect(items[0]["default_code_16"]).to eq("A001B001C001D000")
      expect(items[0]["default_manage_no"]).to eq("1")
    end

    it "階層と名称で絞り込める" do
      get "/master/nursing_acts/actions", params: { level2_code: "B002" }
      expect(body["items"].map { |i| i["level3_code"] }).to eq(%w[C010])
      get "/master/nursing_acts/actions", params: { name: "行為C001" }
      expect(body["items"].map { |i| i["level3_code"] }).to eq(%w[C001])
    end
  end

  describe "POST /master/nursing_acts/import" do
    it "配布ファイルを取り込む" do
      file = Rack::Test::UploadedFile.new(Rails.root.join("spec/fixtures/files/nursing_acts_sample.txt"), "text/plain")
      post "/master/nursing_acts/import", params: { file: file }
      expect(response).to have_http_status(:ok)
      expect(body["imported"]).to eq(3)
      expect(Master::NursingAct.count).to eq(3)
    end
  end
end
