require "rails_helper"

RSpec.describe "Master::MicroSusceptibilityMethods", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/micro_susceptibility_methods" do
    let!(:auto) do
      Master::MicroSusceptibilityMethod.create!(code: "11", name: "微量液体希釈法",
                                                classification: "自動化機器", display_order: 10)
    end
    let!(:disk) do
      Master::MicroSusceptibilityMethod.create!(code: "51", name: "ディスク拡散法",
                                                classification: "用手法", display_order: 20)
    end
    let!(:local_method) do
      Master::MicroSusceptibilityMethod.create!(code: "01", name: "施設追加方法", source: "local",
                                                display_order: 30)
    end

    it "掲載順で返す" do
      get "/master/micro_susceptibility_methods"
      expect(body["items"].map { |i| i["code"] }).to eq(%w[11 51 01])
    end

    it "方法名で検索できる" do
      get "/master/micro_susceptibility_methods", params: { name: "ディスク" }
      expect(body["items"].map { |i| i["code"] }).to eq([disk.code])
    end

    it "source で絞り込める" do
      get "/master/micro_susceptibility_methods", params: { source: "local" }
      expect(body["items"].map { |i| i["code"] }).to eq([local_method.code])
    end
  end

  describe "CRUD" do
    let!(:official_method) do
      Master::MicroSusceptibilityMethod.create!(code: "11", name: "微量液体希釈法")
    end
    let!(:local_method) do
      Master::MicroSusceptibilityMethod.create!(code: "01", name: "施設追加方法", source: "local")
    end

    it "作成した方法は施設追加(local)になる" do
      post "/master/micro_susceptibility_methods",
           params: { code: "02", name: "新しい方法", source: "official" }, as: :json

      expect(response).to have_http_status(:created)
      expect(Master::MicroSusceptibilityMethod.find_by(code: "02").source).to eq("local")
    end

    it "標準コードは編集できない" do
      patch "/master/micro_susceptibility_methods/#{official_method.id}",
            params: { name: "書き換え" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(official_method.reload.name).to eq("微量液体希釈法")
    end

    it "施設追加コードは名称を編集できる" do
      patch "/master/micro_susceptibility_methods/#{local_method.id}",
            params: { name: "改名した方法" }, as: :json

      expect(local_method.reload.name).to eq("改名した方法")
    end

    it "標準コードは削除できない" do
      delete "/master/micro_susceptibility_methods/#{official_method.id}"

      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::MicroSusceptibilityMethod.exists?(official_method.id)).to be(true)
    end

    it "施設追加コードは削除できる" do
      delete "/master/micro_susceptibility_methods/#{local_method.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::MicroSusceptibilityMethod.exists?(local_method.id)).to be(false)
    end
  end

  describe "POST /master/micro_susceptibility_methods/import" do
    it "JANIS 測定法コード表を取り込んで件数と読んだシートを返す" do
      file = Rack::Test::UploadedFile.new(
        Rails.root.join("spec/fixtures/files/micro_susceptibility_methods_sample.xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )

      post "/master/micro_susceptibility_methods/import", params: { file: file }

      expect(body["imported"]).to eq(4)
      expect(body["skipped"]).to eq(2)
      expect(body["sheet"]).to eq("Ver.4.0")
    end

    it "ファイルが無ければ 422 を返す" do
      post "/master/micro_susceptibility_methods/import"

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
