require "rails_helper"

RSpec.describe "Master::RadItems", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_item(code, overrides = {})
    Master::RadItem.create!({ item_code: code, name: "項目#{code}" }.merge(overrides))
  end

  describe "GET /master/rad_items" do
    before do
      create_item("R0001", name: "胸部単純Ｘ線正面", short_name: "胸部XP", name_kana: "キョウブエックスピー",
                  modality_code: "1", body_part_code: "200", display_order: 20)
      create_item("R0002", name: "頭部CTセット", kind: "set", display_order: 10)
      create_item("R0003", name: "旧項目", valid_to: Date.current - 1, display_order: 30)
    end

    it "表示順で返す" do
      get "/master/rad_items"
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[R0002 R0001 R0003])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/rad_items", params: { item_code: "R0001,R0003" }
      expect(body["items"].map { |i| i["item_code"] }).to match_array(%w[R0001 R0003])
    end

    it "kind・種別(モダリティ)・部位で絞り込める" do
      get "/master/rad_items", params: { kind: "set" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[R0002])

      get "/master/rad_items", params: { modality_code: "1" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[R0001])

      get "/master/rad_items", params: { body_part_code: "200" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[R0001])
    end

    it "active=true は有効期間内の項目だけ返す" do
      get "/master/rad_items", params: { active: "true" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[R0002 R0001])
    end

    it "名称・略称・カナで検索できる" do
      get "/master/rad_items", params: { name: "胸部xp" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[R0001])

      get "/master/rad_items", params: { name: "きょうぶ" }
      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[R0001])
    end

    it "一覧に載っている要素コードの名称を添える" do
      Master::RadJj1017Code.create!(element: "modality", code: "1", name: "Ｘ線単純撮影")
      Master::RadJj1017Code.create!(element: "body_part", code: "200", name: "胸部")

      get "/master/rad_items"

      expect(body["elements"]["modality"]).to eq("1" => "Ｘ線単純撮影")
      expect(body["elements"]["body_part"]).to eq("200" => "胸部")
    end
  end

  describe "GET /master/rad_items/:id" do
    it "要素の名称とセット構成を添えて返す(コードでも引ける)" do
      Master::RadJj1017Code.create!(element: "modality", code: "6", name: "Ｘ線CT検査")
      create_item("R0002", name: "頭部CTセット", kind: "set")
      create_item("R0004", name: "頭部CT単純", modality_code: "6", body_part_code: "100")
      Master::RadSetItem.create!(set_item_code: "R0002", member_item_code: "R0004", display_order: 1)

      get "/master/rad_items/R0002"

      expect(body["name"]).to eq("頭部CTセット")
      expect(body["set_items"].map { |m| m["member_name"] }).to eq(["頭部CT単純"])
    end
  end

  describe "POST /master/rad_items" do
    it "要素から32桁コードを組み立てて保存する" do
      post "/master/rad_items", params: {
        item_code: "R0001", name: "胸部単純Ｘ線立位正面",
        modality_code: "1", body_part_code: "200", body_position_code: "1", direction_code: "01",
        nuclide_code: "01"
      }

      expect(response).to have_http_status(:created)
      # 1(種別) 00 00 00(手技) 200(部位) 0(左右) 1(体位) 01(方向) 00(汎用拡張)
      # 00(詳細体位) 00(特殊指示) 01(核種) 0000(超音波) 000000(予約)
      expect(body["jj1017_code"]).to eq("10000002000101000000010000000000")
    end

    it "要素を指定しなければ0埋めになる" do
      post "/master/rad_items", params: { item_code: "R0001", name: "未設定の項目" }

      expect(body["jj1017_code"]).to eq("0" * 32)
    end

    it "項目コードを省略すると自動採番する" do
      create_item("000012")

      post "/master/rad_items", params: { name: "自動採番の項目" }

      expect(body["item_code"]).to eq("000013")
    end

    it "セットは32桁コードを持たない" do
      post "/master/rad_items", params: { item_code: "R0002", name: "頭部CTセット", kind: "set",
                                          modality_code: "6" }

      expect(body["jj1017_code"]).to be_nil
    end

    it "要素コードの桁数を検査する" do
      post "/master/rad_items", params: { item_code: "R0001", name: "桁違い", body_part_code: "20" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("部位(小部位)")
    end

    it "検査目的・特記事項の既定テンプレートを保存する" do
      post "/master/rad_items", params: {
        item_code: "R0001", name: "胸部単純Ｘ線",
        purpose_template_canonical: "http://example.com/Questionnaire/rad-purpose|1.0",
        remarks_template_canonical: "http://example.com/Questionnaire/rad-remarks"
      }

      expect(response).to have_http_status(:created)
      record = Master::RadItem.find_by(item_code: "R0001")
      expect(record.purpose_template_canonical).to eq("http://example.com/Questionnaire/rad-purpose|1.0")
      expect(record.remarks_template_canonical).to eq("http://example.com/Questionnaire/rad-remarks")
    end

    it "有効終了日が有効開始日より前なら登録できない" do
      post "/master/rad_items", params: { item_code: "R0001", name: "期間おかしい",
                                          valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("有効開始日以降")
    end
  end

  describe "PATCH /master/rad_items/:id" do
    it "要素を変えると32桁コードも作り直す" do
      item = create_item("R0001", modality_code: "1", body_part_code: "200")

      patch "/master/rad_items/R0001", params: { body_part_code: "100" }

      expect(item.reload.jj1017_code[7, 3]).to eq("100")
    end
  end

  describe "DELETE /master/rad_items/:id" do
    it "ぶら下がるセット構成も片付ける" do
      create_item("R0002", kind: "set")
      create_item("R0004")
      Master::RadSetItem.create!(set_item_code: "R0002", member_item_code: "R0004")

      delete "/master/rad_items/R0002"

      expect(response).to have_http_status(:no_content)
      expect(Master::RadSetItem.count).to eq(0)
    end
  end

  describe "POST /master/rad_items/bulk_create_from_frequent" do
    let!(:chest) do
      Master::RadJj1017FrequentCode.create!(
        category: "rad_exam", jj1017_code: "10000002000101000000010000000000",
        name: "Ｘ線単純撮影胸部立位正面(指定無し)", display_order: 1
      )
    end
    let!(:head) do
      Master::RadJj1017FrequentCode.create!(
        category: "rad_exam", jj1017_code: "10000001000002000000010000000000",
        name: "Ｘ線単純撮影頭部正面(A→P)", display_order: 2
      )
    end

    it "32桁コードを要素に分解して単項目として作る" do
      post "/master/rad_items/bulk_create_from_frequent",
           params: { frequent_code_ids: [chest.id, head.id] }

      expect(body["created"]).to eq(2)
      item = Master::RadItem.find_by(jj1017_code: chest.jj1017_code)
      expect(item.name).to eq("Ｘ線単純撮影胸部立位正面(指定無し)")
      expect(item.kind).to eq("single")
      expect(item.modality_code).to eq("1")
      expect(item.body_part_code).to eq("200")
      expect(item.body_position_code).to eq("1")
      expect(item.direction_code).to eq("01")
      expect(item.nuclide_code).to eq("01")
      expect(item.valid_from).to eq(Date.current)
    end

    it "掲載順で連番の項目コードを振る" do
      post "/master/rad_items/bulk_create_from_frequent",
           params: { frequent_code_ids: [head.id, chest.id] }

      expect(Master::RadItem.order(:item_code).pluck(:item_code, :name))
        .to eq([["000001", chest.name], ["000002", head.name]])
    end

    it "既に同じ32桁コードの項目があれば作らない" do
      create_item("R0001", jj1017_code: chest.jj1017_code, modality_code: "1", body_part_code: "200",
                  body_position_code: "1", direction_code: "01", nuclide_code: "01")

      post "/master/rad_items/bulk_create_from_frequent",
           params: { frequent_code_ids: [chest.id, head.id] }

      expect(body["created"]).to eq(1)
      expect(body["skipped"].map { |s| s["jj1017_code"] }).to eq([chest.jj1017_code])
    end

    it "選択が空ならエラーを返す" do
      post "/master/rad_items/bulk_create_from_frequent", params: { frequent_code_ids: [] }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
