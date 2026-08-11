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
