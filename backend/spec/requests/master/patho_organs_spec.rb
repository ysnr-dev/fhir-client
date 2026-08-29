require "rails_helper"

RSpec.describe "Master::PathoOrgans", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/patho_organs" do
    let!(:stomach) do
      Master::PathoOrgan.create!(code: "01010300", name: "胃前庭部", icd10: "C16.3",
                                 frequent: true, display_order: 20)
    end
    let!(:lip) do
      Master::PathoOrgan.create!(code: "00000000", name: "外側上唇（赤唇）", icd10: "C00.0",
                                 display_order: 10)
    end
    let!(:local_organ) do
      Master::PathoOrgan.create!(code: "90000000", name: "施設追加材料", source: "local",
                                 display_order: 30)
    end

    it "掲載順で返す" do
      get "/master/patho_organs"
      expect(body["items"].map { |i| i["code"] }).to eq(%w[00000000 01010300 90000000])
    end

    it "frequent=true は頻用臓器だけ返す" do
      get "/master/patho_organs", params: { frequent: "true" }
      expect(body["items"].map { |i| i["code"] }).to eq([stomach.code])
    end

    it "臓器名で検索できる" do
      get "/master/patho_organs", params: { name: "胃前庭" }
      expect(body["items"].map { |i| i["code"] }).to eq([stomach.code])
    end

    # ICD-10 でも引けると「C16 で胃の材料をまとめて絞る」使い方ができる。
    it "ICD-10 コードで検索できる" do
      get "/master/patho_organs", params: { name: "C00" }
      expect(body["items"].map { |i| i["code"] }).to eq([lip.code])
    end

    it "source で絞り込める" do
      get "/master/patho_organs", params: { source: "local" }
      expect(body["items"].map { |i| i["code"] }).to eq([local_organ.code])
    end
  end

  describe "CRUD" do
    let!(:official_organ) do
      Master::PathoOrgan.create!(code: "01010300", name: "胃前庭部", icd10: "C16.3")
    end
    let!(:local_organ) do
      Master::PathoOrgan.create!(code: "90000000", name: "施設追加材料", source: "local")
    end

    it "作成した臓器は施設追加(local)になる" do
      post "/master/patho_organs",
           params: { code: "90000001", name: "新しい材料", source: "official" }, as: :json

      expect(response).to have_http_status(:created)
      expect(Master::PathoOrgan.find_by(code: "90000001").source).to eq("local")
    end

    it "標準コードは頻用の印だけを切り替えられる" do
      patch "/master/patho_organs/#{official_organ.id}",
            params: { frequent: true, name: "書き換え" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(official_organ.reload).to have_attributes(frequent: true, name: "胃前庭部")
    end

    it "施設追加コードは名称を編集できる" do
      patch "/master/patho_organs/#{local_organ.id}", params: { name: "改名した材料" }, as: :json

      expect(local_organ.reload.name).to eq("改名した材料")
    end

    it "標準コードは削除できない" do
      delete "/master/patho_organs/#{official_organ.id}"

      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::PathoOrgan.exists?(official_organ.id)).to be(true)
    end

    it "施設追加コードは削除できる" do
      delete "/master/patho_organs/#{local_organ.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::PathoOrgan.exists?(local_organ.id)).to be(false)
    end
  end
end
