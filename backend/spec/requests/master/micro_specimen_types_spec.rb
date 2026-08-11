require "rails_helper"

RSpec.describe "Master::MicroSpecimenTypes", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/micro_specimen_types" do
    let!(:sputum) do
      Master::MicroSpecimenType.create!(code: "101", name: "喀出痰",
                                        category: "口腔・気道・呼吸器", display_order: 10)
    end
    let!(:urine) do
      Master::MicroSpecimenType.create!(code: "201", name: "自然排尿",
                                        category: "泌尿器・生殖器", display_order: 20)
    end

    it "掲載順で返す" do
      get "/master/micro_specimen_types"
      expect(body["items"].map { |i| i["code"] }).to eq(%w[101 201])
    end

    it "系統で絞り込める" do
      get "/master/micro_specimen_types", params: { category: "泌尿器・生殖器" }
      expect(body["items"].map { |i| i["code"] }).to eq([urine.code])
    end

    it "材料名で検索できる" do
      get "/master/micro_specimen_types", params: { name: "痰" }
      expect(body["items"].map { |i| i["code"] }).to eq([sputum.code])
    end
  end

  describe "CRUD" do
    let!(:official_type) { Master::MicroSpecimenType.create!(code: "101", name: "喀出痰") }
    let!(:local_type) do
      Master::MicroSpecimenType.create!(code: "901", name: "施設追加材料", source: "local")
    end

    it "作成した材料は施設追加(local)になる" do
      post "/master/micro_specimen_types", params: { code: "902", name: "新しい材料" }, as: :json

      expect(response).to have_http_status(:created)
      expect(Master::MicroSpecimenType.find_by(code: "902").source).to eq("local")
    end

    it "標準コードは編集も削除もできない" do
      patch "/master/micro_specimen_types/#{official_type.id}", params: { name: "書き換え" }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      delete "/master/micro_specimen_types/#{official_type.id}"
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "施設追加コードは編集・削除できる" do
      patch "/master/micro_specimen_types/#{local_type.id}", params: { name: "改名した材料" }, as: :json
      expect(local_type.reload.name).to eq("改名した材料")

      delete "/master/micro_specimen_types/#{local_type.id}"
      expect(response).to have_http_status(:no_content)
    end
  end

  describe "POST /master/micro_specimen_types/import" do
    it "JANIS 材料コード表を取り込んで件数を返す" do
      file = Rack::Test::UploadedFile.new(
        Rails.root.join("spec/fixtures/files/micro_specimen_types_sample.xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )

      post "/master/micro_specimen_types/import", params: { file: file }

      expect(body["imported"]).to eq(4)
      expect(body["skipped"]).to eq(1)
    end

    it "ファイルが無ければ 422 を返す" do
      post "/master/micro_specimen_types/import"

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
