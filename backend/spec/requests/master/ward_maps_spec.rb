require "rails_helper"

RSpec.describe "Master::WardMaps", type: :request do
  def body
    JSON.parse(response.body)
  end

  def layout(objects = [])
    { schema_version: 1, canvas: { width: 60, height: 40 }, grid_size: 20, objects: objects }
  end

  def nurse_station
    { id: "f1", type: "fixture", kind: "nurse_station", x: 0, y: 0, w: 8, h: 4, rotation: 0, label: "NS" }
  end

  def bed
    { id: "b1", type: "bed", location_id: "bed-1", room_id: "room-1", x: 11, y: 1, w: 6, h: 5, rotation: 0 }
  end

  describe "GET /master/ward_maps" do
    before do
      Master::WardMap.create!(ward_location_id: "ward-2", ward_name: "西3階病棟", layout: layout)
      Master::WardMap.create!(ward_location_id: "ward-1", ward_name: "東3階病棟", layout: layout)
    end

    it "病棟名順で一覧を返す" do
      get "/master/ward_maps"

      expect(body["items"].map { |i| i["ward_location_id"] }).to eq(%w[ward-1 ward-2])
    end

    it "病棟で絞り込める" do
      get "/master/ward_maps", params: { ward_location_id: "ward-2" }

      expect(body["items"].map { |i| i["ward_name"] }).to eq(%w[西3階病棟])
    end
  end

  describe "POST /master/ward_maps" do
    it "ネストした layout をそのまま保存する" do
      post "/master/ward_maps",
           params: { ward_location_id: "ward-1", ward_name: "東3階病棟", layout: layout([nurse_station, bed]) },
           as: :json

      expect(response).to have_http_status(:created)
      stored = Master::WardMap.find(body["id"])
      expect(stored.layout["objects"].size).to eq(2)
      expect(stored.layout["objects"].first).to include("kind" => "nurse_station", "label" => "NS")
      expect(stored.layout["canvas"]).to eq("width" => 60, "height" => 40)
    end

    it "不正な layout は 422 で理由を返す" do
      post "/master/ward_maps",
           params: { ward_location_id: "ward-1", layout: layout([nurse_station.merge(x: 59)]) },
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("外に出て")
    end

    it "同じ病棟の 2 件目は 422" do
      Master::WardMap.create!(ward_location_id: "ward-1", layout: layout)

      post "/master/ward_maps", params: { ward_location_id: "ward-1", layout: layout }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /master/ward_maps/:id" do
    it "layout を丸ごと置き換える" do
      record = Master::WardMap.create!(ward_location_id: "ward-1", layout: layout([nurse_station]))

      patch "/master/ward_maps/#{record.id}", params: { ward_name: "東3階病棟", layout: layout([bed]) }, as: :json

      expect(response).to have_http_status(:ok)
      expect(record.reload.layout["objects"].map { |o| o["type"] }).to eq(%w[bed])
      expect(record.ward_name).to eq("東3階病棟")
    end
  end

  describe "DELETE /master/ward_maps/:id" do
    it "削除できる" do
      record = Master::WardMap.create!(ward_location_id: "ward-1", layout: layout)

      delete "/master/ward_maps/#{record.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::WardMap.exists?(record.id)).to be(false)
    end
  end
end
