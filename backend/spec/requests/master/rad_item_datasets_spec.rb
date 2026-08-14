require "rails_helper"

RSpec.describe "Master::RadItemDatasets", type: :request do
  def body
    JSON.parse(response.body)
  end

  before do
    Master::RadDataset.create!(dataset_code: "000001", name: "造影CT標準セット")
    Master::RadDataset.create!(dataset_code: "000002", name: "穿刺器材セット")
  end

  describe "GET /master/rad_item_datasets" do
    before do
      Master::RadItemDataset.create!(item_code: "000100", dataset_code: "000001", display_order: 1)
      Master::RadItemDataset.create!(item_code: "000100", dataset_code: "000002", display_order: 2)
      Master::RadItemDataset.create!(item_code: "000200", dataset_code: "000001", display_order: 1)
    end

    it "撮影項目コードをカンマ区切りで複数指定してデータセット名付きで引ける" do
      get "/master/rad_item_datasets", params: { item_code: "000100,000200" }

      expect(body["items"].size).to eq(3)
      expect(body["items"].map { |i| i["dataset_name"] }).to include("造影CT標準セット", "穿刺器材セット")
    end

    it "撮影項目1件で絞り込める" do
      get "/master/rad_item_datasets", params: { item_code: "000200" }

      expect(body["items"].map { |i| i["dataset_code"] }).to eq(%w[000001])
    end

    it "データセットから逆に使われている撮影項目を引ける" do
      get "/master/rad_item_datasets", params: { dataset_code: "000002" }

      expect(body["items"].map { |i| i["item_code"] }).to eq(%w[000100])
    end
  end

  describe "POST /master/rad_item_datasets" do
    it "紐付けを登録し、表示順を追加順に採番する" do
      post "/master/rad_item_datasets", params: { item_code: "000100", dataset_code: "000001" }
      expect(response).to have_http_status(:created)
      expect(body["display_order"]).to eq(1)

      post "/master/rad_item_datasets", params: { item_code: "000100", dataset_code: "000002" }
      expect(body["display_order"]).to eq(2)
    end

    it "同じ撮影項目に同じデータセットは二重に紐付けられない" do
      Master::RadItemDataset.create!(item_code: "000100", dataset_code: "000001")

      post "/master/rad_item_datasets", params: { item_code: "000100", dataset_code: "000001" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "1つのデータセットを複数の撮影項目から使い回せる" do
      Master::RadItemDataset.create!(item_code: "000100", dataset_code: "000001")

      post "/master/rad_item_datasets", params: { item_code: "000200", dataset_code: "000001" }

      expect(response).to have_http_status(:created)
    end
  end

  describe "DELETE /master/rad_item_datasets/:id" do
    it "紐付けだけを外す(データセット本体は残る)" do
      record = Master::RadItemDataset.create!(item_code: "000100", dataset_code: "000001")

      delete "/master/rad_item_datasets/#{record.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::RadItemDataset.count).to eq(0)
      expect(Master::RadDataset.find_by(dataset_code: "000001")).to be_present
    end
  end
end
