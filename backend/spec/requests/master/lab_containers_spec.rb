require "rails_helper"

RSpec.describe "Master::LabContainers", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/lab_containers" do
    before do
      Master::LabContainer.create!(container_code: "T03", name: "EDTA-2K管", cap_color: "紫",
                                   additive: "EDTA-2K", display_order: 30)
      Master::LabContainer.create!(container_code: "T01", name: "生化学用分離剤入り管",
                                   cap_color: "茶", display_order: 10)
    end

    it "表示順で返し、名称・コードで絞り込める" do
      get "/master/lab_containers"
      expect(body["items"].map { |c| c["container_code"] }).to eq(%w[T01 T03])

      get "/master/lab_containers", params: { name: "EDTA" }
      expect(body["items"].map { |c| c["container_code"] }).to eq(%w[T03])

      get "/master/lab_containers", params: { container_code: "T01,T03" }
      expect(body["items"].map { |c| c["container_code"] }).to match_array(%w[T01 T03])
    end
  end

  describe "CRUD" do
    it "作成・更新・削除できる" do
      post "/master/lab_containers", params: {
        container_code: "T20", name: "滅菌スピッツ", capacity: "10mL",
      }, as: :json
      expect(response).to have_http_status(:created)
      id = body["id"]

      patch "/master/lab_containers/#{id}", params: { cap_color: "白" }, as: :json
      expect(body["cap_color"]).to eq("白")

      delete "/master/lab_containers/#{id}"
      expect(response).to have_http_status(:no_content)
    end

    it "コードの二重登録はできない" do
      Master::LabContainer.create!(container_code: "T20", name: "滅菌スピッツ")

      post "/master/lab_containers", params: { container_code: "T20", name: "重複" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
