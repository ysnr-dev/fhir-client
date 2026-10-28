require "rails_helper"

RSpec.describe "WaitingBoard::Staff", type: :request do
  def body = JSON.parse(response.body)

  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  describe "リンク" do
    it "発行・一覧・取消。一覧でも同じ表示板のパスを起こし直して返す" do
      with_admin_token(nil) { post "/waiting_board/links", params: { label: "1 階ロビー", location_ids: ["room-1", ""] }, as: :json }
      expect(response).to have_http_status(:created)
      expect(body["path"]).to match(%r{\A/board/[A-Za-z0-9_-]{40,}\z})
      expect(body["location_ids"]).to eq(["room-1"])
      id = body["id"]
      path = body["path"]

      with_admin_token(nil) { get "/waiting_board/links" }
      expect(body["items"].map { |i| i.slice("id", "label", "location_ids") }).to eq([{ "id" => id, "label" => "1 階ロビー", "location_ids" => ["room-1"] }])
      expect(body["items"][0]["path"]).to eq(path)
      expect(WaitingBoardLink.find(id).token_salt).to be_present
      expect(body["items"][0]).not_to have_key("token_digest")

      with_admin_token(nil) { delete "/waiting_board/links/#{id}" }
      expect(response).to have_http_status(:no_content)
      with_admin_token(nil) { get "/waiting_board/links" }
      expect(body["items"]).to eq([])
    end

    it "salt の無いリンクは path が null(発行し直す)" do
      WaitingBoardLink.create!(label: "旧", token_digest: WaitingBoardLink.digest("legacy"))
      with_admin_token(nil) { get "/waiting_board/links" }
      expect(body["items"][0]).to include("label" => "旧", "path" => nil)
    end

    it "名前が無ければ 422" do
      with_admin_token(nil) { post "/waiting_board/links", params: { label: " " }, as: :json }
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "ログインが要る" do
      with_admin_token("secret") { get "/waiting_board/links" }
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "受付番号" do
    it "同じ日は 1, 2 と進み、別の日は 1 から" do
      with_admin_token(nil) { post "/waiting_board/reception_numbers", params: { day: "2026-10-28" }, as: :json }
      expect(response).to have_http_status(:created)
      expect(body).to eq("day" => "2026-10-28", "number" => 1)

      with_admin_token(nil) { post "/waiting_board/reception_numbers", params: { day: "2026-10-28" }, as: :json }
      expect(body["number"]).to eq(2)

      with_admin_token(nil) { post "/waiting_board/reception_numbers", params: { day: "2026-10-29" }, as: :json }
      expect(body["number"]).to eq(1)
    end

    it "day が無ければ施設の今日、形が違えば 422" do
      allow(FacilityClock).to receive(:today).and_return(Date.new(2026, 10, 28))
      with_admin_token(nil) { post "/waiting_board/reception_numbers", as: :json }
      expect(body["day"]).to eq("2026-10-28")

      with_admin_token(nil) { post "/waiting_board/reception_numbers", params: { day: "28/10/2026" }, as: :json }
      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
