require "rails_helper"

RSpec.describe "Master::MicroOrganisms", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/micro_organisms" do
    let!(:strep) do
      Master::MicroOrganism.create!(code: "1100", name: "Streptococcus sp.", display_order: 10)
    end
    let!(:staph) do
      Master::MicroOrganism.create!(code: "2101", name: "Staphylococcus aureus",
                                    frequent: true, display_order: 20)
    end
    let!(:local_bug) do
      Master::MicroOrganism.create!(code: "0001", name: "施設追加菌", source: "local",
                                    display_order: 30)
    end

    it "掲載順で返す" do
      get "/master/micro_organisms"
      expect(body["items"].map { |i| i["code"] }).to eq(%w[1100 2101 0001])
    end

    it "frequent=true は頻用菌だけ返す" do
      get "/master/micro_organisms", params: { frequent: "true" }
      expect(body["items"].map { |i| i["code"] }).to eq([staph.code])
    end

    it "菌名で検索できる(大文字小文字を無視)" do
      get "/master/micro_organisms", params: { name: "staphylococcus" }
      expect(body["items"].map { |i| i["code"] }).to eq([staph.code])
    end

    it "source で絞り込める" do
      get "/master/micro_organisms", params: { source: "local" }
      expect(body["items"].map { |i| i["code"] }).to eq([local_bug.code])
    end
  end

  describe "POST /master/micro_organisms/import" do
    it "JANIS 病原体コード表を取り込んで件数と読んだシートを返す" do
      file = Rack::Test::UploadedFile.new(
        Rails.root.join("spec/fixtures/files/micro_organisms_sample.xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )

      post "/master/micro_organisms/import", params: { file: file }

      expect(body["imported"]).to eq(3)
      expect(body["skipped"]).to eq(2)
      expect(body["sheet"]).to eq("Ver.6.1")
    end

    it "ファイルが無ければ 422 を返す" do
      post "/master/micro_organisms/import"

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
