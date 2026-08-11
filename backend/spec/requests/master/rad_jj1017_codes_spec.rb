require "rails_helper"

RSpec.describe "Master::RadJj1017Codes", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_code(element, code, overrides = {})
    Master::RadJj1017Code.create!({ element: element, code: code, name: "#{element}#{code}" }.merge(overrides))
  end

  describe "GET /master/rad_jj1017_codes" do
    before do
      create_code("modality", "1", name: "Ｘ線単純撮影", display_order: 20)
      create_code("body_part", "100", name: "頭部", name_english: "HEAD", display_order: 10,
                  use_general: true, use_ct: true)
      create_code("body_part", "601", name: "脳", name_english: "Brain", display_order: 20, use_ct: true)
      create_code("body_part", "A00", name: "院内独自部位", source: "local", display_order: 30)
    end

    it "要素で絞り込み、掲載順で返す" do
      get "/master/rad_jj1017_codes", params: { element: "body_part" }
      expect(body["items"].map { |i| i["code"] }).to eq(%w[100 601 A00])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/rad_jj1017_codes", params: { element: "body_part", code: "100,A00" }
      expect(body["items"].map { |i| i["code"] }).to match_array(%w[100 A00])
    end

    it "標準コードと施設拡張コードを出し分けられる" do
      get "/master/rad_jj1017_codes", params: { element: "body_part", source: "local" }
      expect(body["items"].map { |i| i["code"] }).to eq(%w[A00])
    end

    it "モダリティ別の使用可否で部位の候補を絞れる" do
      get "/master/rad_jj1017_codes", params: { element: "body_part", modality_use: "general" }
      expect(body["items"].map { |i| i["code"] }).to eq(%w[100])
    end

    it "名称で検索できる(英語名・通称名も検索対象)" do
      get "/master/rad_jj1017_codes", params: { name: "頭部" }
      expect(body["items"].map { |i| i["code"] }).to eq(%w[100])

      get "/master/rad_jj1017_codes", params: { name: "brain" }
      expect(body["items"].map { |i| i["code"] }).to eq(%w[601])
    end
  end

  describe "GET /master/rad_jj1017_codes/elements" do
    it "32桁コード内の位置・桁数・施設拡張の可否と件数を返す" do
      create_code("body_part", "100", name: "頭部")
      create_code("body_part", "A00", name: "院内独自部位", source: "local")

      get "/master/rad_jj1017_codes/elements"

      expect(body["code_length"]).to eq(32)
      expect(body["generic_extension"]).to eq("offset" => 14, "length" => 2)

      body_part = body["elements"].find { |e| e["element"] == "body_part" }
      expect(body_part["label"]).to eq("部位(小部位)")
      # 部位は8〜10桁目。
      expect(body_part["offset"]).to eq(7)
      expect(body_part["length"]).to eq(3)
      expect(body_part["extension_allowed"]).to be(true)
      expect(body_part["official_count"]).to eq(1)
      expect(body_part["local_count"]).to eq(1)

      # 左右等は指針上ユーザ拡張を認めていない。
      expect(body["elements"].find { |e| e["element"] == "laterality" }["extension_allowed"])
        .to be(false)
    end
  end

  describe "GET /master/rad_jj1017_codes/catalog" do
    it "全要素のコードを要素名でまとめて返す" do
      create_code("modality", "1", name: "Ｘ線単純撮影", display_order: 20)
      create_code("body_part", "100", name: "頭部", display_order: 10, use_ct: true)
      create_code("body_part", "601", name: "脳", display_order: 20)

      get "/master/rad_jj1017_codes/catalog"

      expect(body.keys).to match_array(%w[modality body_part])
      expect(body["body_part"].map { |c| c["code"] }).to eq(%w[100 601])
      expect(body["body_part"].first["use_ct"]).to be(true)
    end
  end

  describe "POST /master/rad_jj1017_codes" do
    it "施設拡張コードとして登録する" do
      post "/master/rad_jj1017_codes",
           params: { element: "body_part", code: "A00", name: "院内独自部位" }

      expect(response).to have_http_status(:created)
      expect(body["source"]).to eq("local")
    end

    it "拡張の範囲外のコードは登録できない" do
      # 部位の施設拡張は A00 以降(英大文字始まり)。
      post "/master/rad_jj1017_codes",
           params: { element: "body_part", code: "123", name: "標準の帯" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("A00以降")
    end

    it "JJ1017 が予約・標準割当している帯のコードは登録できない" do
      # 手技(大分類)の J/P は核医学・放射線治療領域の割当済み、Z は予約。
      post "/master/rad_jj1017_codes",
           params: { element: "procedure_major", code: "J1", name: "核医学の帯" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("割り当て済み")
    end

    it "桁数と使用可能文字を検査する" do
      post "/master/rad_jj1017_codes", params: { element: "body_part", code: "A0", name: "桁不足" }
      expect(body["errors"].join).to include("3桁")

      # I と O は JJ1017 では使わない。
      post "/master/rad_jj1017_codes", params: { element: "body_part", code: "AI0", name: "使えない文字" }
      expect(body["errors"].join).to include("I と O")
    end

    it "拡張が認められていない要素には登録できない" do
      post "/master/rad_jj1017_codes", params: { element: "laterality", code: "X", name: "独自の左右" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("施設拡張が認められていません")
    end

    it "同じ要素の同じコードは登録できない" do
      create_code("body_part", "A00")

      post "/master/rad_jj1017_codes", params: { element: "body_part", code: "A00", name: "重複" }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /master/rad_jj1017_codes/:id" do
    it "施設拡張コードの名称を直せる" do
      record = create_code("body_part", "A00", source: "local")

      patch "/master/rad_jj1017_codes/#{record.id}", params: { name: "新しい名称" }

      expect(record.reload.name).to eq("新しい名称")
    end

    it "配布ファイル由来の標準コードは編集できない" do
      record = create_code("body_part", "100", name: "頭部")

      patch "/master/rad_jj1017_codes/#{record.id}", params: { name: "書き換え" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(record.reload.name).to eq("頭部")
    end
  end

  describe "DELETE /master/rad_jj1017_codes/:id" do
    it "施設拡張コードを削除できる" do
      record = create_code("body_part", "A00", source: "local")

      delete "/master/rad_jj1017_codes/#{record.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::RadJj1017Code.exists?(record.id)).to be(false)
    end

    it "配布ファイル由来の標準コードは削除できない" do
      record = create_code("body_part", "100", name: "頭部")

      delete "/master/rad_jj1017_codes/#{record.id}"

      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::RadJj1017Code.exists?(record.id)).to be(true)
    end

    it "オーダー項目で使用中の拡張コードは削除できない" do
      record = create_code("body_part", "A00", source: "local")
      Master::RadItem.create!(item_code: "R0001", name: "院内独自撮影", body_part_code: "A00")

      delete "/master/rad_jj1017_codes/#{record.id}"

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("1件で使用中")
    end
  end

  describe "POST /master/rad_jj1017_codes/import" do
    it "別表を取り込んで件数を返す" do
      file = Rack::Test::UploadedFile.new(
        Rails.root.join("spec/fixtures/files/rad_jj1017_body_parts_sample.xls"),
        "application/vnd.ms-excel"
      )

      post "/master/rad_jj1017_codes/import", params: { file: file }

      expect(body["imported"]).to eq(3)
      expect(body["elements"]).to eq("body_part" => 3)
    end

    it "ファイルが無ければエラーを返す" do
      post "/master/rad_jj1017_codes/import"

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
