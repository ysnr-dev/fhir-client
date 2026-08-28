require "rails_helper"

RSpec.describe "Master::SurgeryRoomBlocks", type: :request do
  def body
    JSON.parse(response.body)
  end

  def block_attributes(**overrides)
    {
      location_id: "or-1", location_name: "第1手術室", weekday: 1,
      start_time: "09:00", end_time: "12:00",
      department_code: "01", department_name: "外科"
    }.merge(overrides)
  end

  describe "GET /master/surgery_room_blocks" do
    before do
      Master::SurgeryRoomBlock.create!(block_attributes)
      Master::SurgeryRoomBlock.create!(block_attributes(start_time: "13:00", end_time: "17:00",
                                                        department_code: "02", department_name: "整形外科"))
      Master::SurgeryRoomBlock.create!(block_attributes(location_id: "or-2", location_name: "第2手術室",
                                                        weekday: 3))
      Master::SurgeryRoomBlock.create!(block_attributes(location_id: "or-3", weekday: 5,
                                                        valid_from: Date.current - 100,
                                                        valid_to: Date.current - 1))
    end

    it "手術室 → 曜日 → 開始時刻の順で一覧を返す" do
      get "/master/surgery_room_blocks"

      expect(body["items"].map { |i| [i["location_id"], i["weekday"], i["start_time"]] })
        .to eq([["or-1", 1, "09:00"], ["or-1", 1, "13:00"], ["or-2", 3, "09:00"], ["or-3", 5, "09:00"]])
    end

    it "手術室で絞り込める" do
      get "/master/surgery_room_blocks", params: { location_id: "or-2" }

      expect(body["items"].map { |i| i["location_id"] }).to eq(%w[or-2])
    end

    it "曜日で絞り込める" do
      get "/master/surgery_room_blocks", params: { weekday: "1" }

      expect(body["items"].size).to eq(2)
    end

    it "active=true は有効期間内の割り当てだけ返す" do
      get "/master/surgery_room_blocks", params: { active: "true" }

      expect(body["items"].map { |i| i["location_id"] }).to eq(%w[or-1 or-1 or-2])
    end

    it "date を渡すとその日で有効期間を判定する" do
      get "/master/surgery_room_blocks", params: { active: "true", date: (Date.current - 50).to_s }

      expect(body["items"].map { |i| i["location_id"] }).to eq(%w[or-1 or-1 or-2 or-3])
    end
  end

  describe "POST /master/surgery_room_blocks" do
    it "割り当てを登録できる" do
      post "/master/surgery_room_blocks", params: block_attributes, as: :json

      expect(response).to have_http_status(:created)
      expect(body["department_name"]).to eq("外科")
    end

    it "終了時刻が開始時刻以前なら弾く" do
      post "/master/surgery_room_blocks", params: block_attributes(start_time: "12:00", end_time: "09:00"),
                                          as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("開始時刻より後")
    end

    it "時刻が HH:MM 形式でなければ弾く" do
      post "/master/surgery_room_blocks", params: block_attributes(start_time: "9時"), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("HH:MM")
    end

    it "同じ手術室・曜日で時間帯が重なる割り当ては弾く" do
      Master::SurgeryRoomBlock.create!(block_attributes)

      post "/master/surgery_room_blocks", params: block_attributes(start_time: "11:00", end_time: "15:00"),
                                          as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("時間帯が重なっています")
    end

    it "境界が接するだけなら重なりにしない" do
      Master::SurgeryRoomBlock.create!(block_attributes)

      post "/master/surgery_room_blocks", params: block_attributes(start_time: "12:00", end_time: "15:00"),
                                          as: :json

      expect(response).to have_http_status(:created)
    end

    it "有効期間が重ならなければ同じ時間帯でも登録できる" do
      Master::SurgeryRoomBlock.create!(block_attributes(valid_to: Date.current - 1))

      post "/master/surgery_room_blocks", params: block_attributes(valid_from: Date.current), as: :json

      expect(response).to have_http_status(:created)
    end

    it "別の手術室なら同じ曜日・時間帯でも登録できる" do
      Master::SurgeryRoomBlock.create!(block_attributes)

      post "/master/surgery_room_blocks", params: block_attributes(location_id: "or-2"), as: :json

      expect(response).to have_http_status(:created)
    end
  end

  describe "PATCH /master/surgery_room_blocks/:id" do
    it "更新できる(自分自身は重なり判定から外れる)" do
      record = Master::SurgeryRoomBlock.create!(block_attributes)

      patch "/master/surgery_room_blocks/#{record.id}", params: { end_time: "13:00" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(body["end_time"]).to eq("13:00")
    end
  end

  describe "DELETE /master/surgery_room_blocks/:id" do
    it "削除できる" do
      record = Master::SurgeryRoomBlock.create!(block_attributes)

      delete "/master/surgery_room_blocks/#{record.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::SurgeryRoomBlock.count).to eq(0)
    end
  end
end
