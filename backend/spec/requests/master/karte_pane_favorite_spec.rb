require "rails_helper"

RSpec.describe "Master::KartePaneFavorite", type: :request do
  let(:admin_token) { "s3cret-admin-passphrase" }

  def with_admin_token(token = admin_token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  def login_as(user, password)
    post "/auth/session", params: { login_id: user.login_id, password: password }, as: :json
    JSON.parse(response.body).fetch("csrf_token")
  end

  def login_as_administrator
    post "/auth/session", params: { login_id: "administrator", password: admin_token }, as: :json
    JSON.parse(response.body).fetch("csrf_token")
  end

  def json_headers(csrf)
    { "CONTENT_TYPE" => "application/json", "X-CSRF-Token" => csrf }
  end

  def body = JSON.parse(response.body)

  describe "認証なし(practitioner_id をパラメータで受ける)" do
    it "保存していない人は空の menu_keys を返す" do
      get "/master/karte_pane_favorite", params: { practitioner_id: "prac-1" }
      expect(response).to have_http_status(:ok)
      expect(body).to include("practitioner_id" => "prac-1", "menu_keys" => [])
    end

    it "practitioner_id が無ければ 403" do
      get "/master/karte_pane_favorite"
      expect(response).to have_http_status(:forbidden)
    end

    it "PUT で保存し、2 回目は並び順ごと置き換える" do
      put "/master/karte_pane_favorite",
          params: { practitioner_id: "prac-1", menu_keys: %w[prescription note] }, as: :json
      expect(response).to have_http_status(:ok)
      expect(body["menu_keys"]).to eq(%w[prescription note])

      put "/master/karte_pane_favorite",
          params: { practitioner_id: "prac-1", menu_keys: %w[note lab-order prescription] }, as: :json
      expect(body["menu_keys"]).to eq(%w[note lab-order prescription])
      expect(KartePaneFavorite.count).to eq(1)

      put "/master/karte_pane_favorite", params: { practitioner_id: "prac-1", menu_keys: [] }, as: :json
      expect(response).to have_http_status(:ok)
      get "/master/karte_pane_favorite", params: { practitioner_id: "prac-1" }
      expect(body["menu_keys"]).to eq([])
    end

    it "形が崩れた menu_keys は 422" do
      bad = [%w[note note], ["Note"], [1], ["a b"], { "a" => "b" }, "note", Array.new(101) { |i| "k#{i}" }]
      bad.each do |keys|
        put "/master/karte_pane_favorite", params: { practitioner_id: "prac-1", menu_keys: keys }, as: :json
        expect(response).to have_http_status(:unprocessable_content), keys.inspect
      end
      expect(KartePaneFavorite.count).to eq(0)
    end
  end

  describe "セッションでログイン中" do
    let(:tanaka) { User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1") }

    it "本人に固定し、practitioner_id パラメータは無視する" do
      with_admin_token do
        csrf = login_as(tanaka, "password123")
        put "/master/karte_pane_favorite",
            params: { practitioner_id: "prac-2", menu_keys: %w[note] }.to_json,
            headers: json_headers(csrf)
        expect(response).to have_http_status(:ok)
        expect(body["practitioner_id"]).to eq("prac-1")
        expect(KartePaneFavorite.pluck(:practitioner_id)).to eq(["prac-1"])
      end
    end

    it "administrator は 403" do
      with_admin_token do
        csrf = login_as_administrator
        get "/master/karte_pane_favorite"
        expect(response).to have_http_status(:forbidden)
        put "/master/karte_pane_favorite", params: { menu_keys: %w[note] }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
      end
    end
  end
end
