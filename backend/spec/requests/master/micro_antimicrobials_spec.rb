require "rails_helper"

RSpec.describe "Master::MicroAntimicrobials", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/micro_antimicrobials" do
    let!(:pcg) do
      Master::MicroAntimicrobial.create!(code: "1201", name: "ベンジルペニシリン",
                                         abbreviation: "PCG", category: "ペニシリン系",
                                         display_order: 10)
    end
    let!(:vcm) do
      Master::MicroAntimicrobial.create!(code: "2301", name: "バンコマイシン",
                                         abbreviation: "VCM", frequent: true, display_order: 20)
    end
    let!(:local_drug) do
      Master::MicroAntimicrobial.create!(code: "0001", name: "施設追加薬", source: "local",
                                         display_order: 30)
    end

    it "掲載順で返す" do
      get "/master/micro_antimicrobials"
      expect(body["items"].map { |i| i["code"] }).to eq(%w[1201 2301 0001])
    end

    it "frequent=true は頻用薬だけ返す" do
      get "/master/micro_antimicrobials", params: { frequent: "true" }
      expect(body["items"].map { |i| i["code"] }).to eq([vcm.code])
    end

    it "薬剤名で検索できる" do
      get "/master/micro_antimicrobials", params: { name: "バンコ" }
      expect(body["items"].map { |i| i["code"] }).to eq([vcm.code])
    end

    it "略号でも検索できる(大文字小文字を無視)" do
      get "/master/micro_antimicrobials", params: { name: "pcg" }
      expect(body["items"].map { |i| i["code"] }).to eq([pcg.code])
    end

    it "source で絞り込める" do
      get "/master/micro_antimicrobials", params: { source: "local" }
      expect(body["items"].map { |i| i["code"] }).to eq([local_drug.code])
    end
  end

  describe "CRUD" do
    let!(:official_drug) do
      Master::MicroAntimicrobial.create!(code: "1201", name: "ベンジルペニシリン")
    end
    let!(:local_drug) do
      Master::MicroAntimicrobial.create!(code: "0001", name: "施設追加薬", source: "local")
    end

    it "作成した薬は施設追加(local)になる" do
      post "/master/micro_antimicrobials",
           params: { code: "0002", name: "新しい薬", source: "official" }, as: :json

      expect(response).to have_http_status(:created)
      expect(Master::MicroAntimicrobial.find_by(code: "0002").source).to eq("local")
    end

    it "標準コードは頻用薬の印だけを切り替えられる" do
      patch "/master/micro_antimicrobials/#{official_drug.id}",
            params: { frequent: true, name: "書き換え" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(official_drug.reload).to have_attributes(frequent: true, name: "ベンジルペニシリン")
    end

    it "施設追加コードは名称を編集できる" do
      patch "/master/micro_antimicrobials/#{local_drug.id}", params: { name: "改名した薬" }, as: :json

      expect(local_drug.reload.name).to eq("改名した薬")
    end

    it "標準コードは削除できない" do
      delete "/master/micro_antimicrobials/#{official_drug.id}"

      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::MicroAntimicrobial.exists?(official_drug.id)).to be(true)
    end

    it "施設追加コードは削除できる" do
      delete "/master/micro_antimicrobials/#{local_drug.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::MicroAntimicrobial.exists?(local_drug.id)).to be(false)
    end
  end

  describe "POST /master/micro_antimicrobials/import" do
    it "JANIS 抗菌薬コード表を取り込んで件数と読んだシートを返す" do
      file = Rack::Test::UploadedFile.new(
        Rails.root.join("spec/fixtures/files/micro_antimicrobials_sample.xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )

      post "/master/micro_antimicrobials/import", params: { file: file }

      expect(body["imported"]).to eq(3)
      expect(body["skipped"]).to eq(2)
      expect(body["sheet"]).to eq("抗菌薬コード一覧")
    end

    it "ファイルが無ければ 422 を返す" do
      post "/master/micro_antimicrobials/import"

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
