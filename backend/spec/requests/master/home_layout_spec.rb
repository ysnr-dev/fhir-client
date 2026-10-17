require "rails_helper"

RSpec.describe "Master::HomeLayout", type: :request do
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

  let(:cards) do
    [
      { "id" => "c1", "kind" => "bulletin" },
      { "id" => "c2", "kind" => "inpatient", "settings" => { "by" => "nurse" } }
    ]
  end

  describe "認証なし(practitioner_id をパラメータで受ける)" do
    it "保存していない人は definition: null を返す" do
      get "/master/home_layout", params: { practitioner_id: "prac-1" }
      expect(response).to have_http_status(:ok)
      expect(body).to include("practitioner_id" => "prac-1", "definition" => nil)
    end

    it "practitioner_id が無ければ 403" do
      get "/master/home_layout"
      expect(response).to have_http_status(:forbidden)
    end

    it "PUT で保存し、2 回目は置き換える" do
      put "/master/home_layout", params: { practitioner_id: "prac-1", definition: { cards: cards } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(body["definition"]).to eq("schema_version" => 1, "cards" => cards)

      put "/master/home_layout",
          params: { practitioner_id: "prac-1", definition: { schema_version: 1, cards: cards.first(1) } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(body["definition"]["cards"].size).to eq(1)
      expect(HomeLayout.count).to eq(1)

      get "/master/home_layout", params: { practitioner_id: "prac-1" }
      expect(body["definition"]["cards"].size).to eq(1)
    end

    it "形が崩れた definition は 422" do
      bad = [
        { cards: [cards.first, cards.first] },
        { cards: [{ "id" => "c1" }] },
        { cards: Array.new(31) { |i| { "id" => "c#{i}", "kind" => "bulletin" } } },
        { cards: [{ "id" => "c1", "kind" => "bulletin", "foo" => 1 }] },
        { cards: [{ "id" => "c1", "kind" => "bulletin", "settings" => [1] }] },
        { schema_version: 2, cards: [] },
        {}
      ]
      bad.each do |definition|
        put "/master/home_layout", params: { practitioner_id: "prac-1", definition: definition }, as: :json
        expect(response).to have_http_status(:unprocessable_content), definition.inspect
      end
      expect(HomeLayout.count).to eq(0)
    end

    it "DELETE で既定に戻す" do
      put "/master/home_layout", params: { practitioner_id: "prac-1", definition: { cards: cards } }, as: :json
      delete "/master/home_layout", params: { practitioner_id: "prac-1" }
      expect(response).to have_http_status(:no_content)
      get "/master/home_layout", params: { practitioner_id: "prac-1" }
      expect(body["definition"]).to be_nil
    end
  end

  describe "セッションでログイン中" do
    let(:tanaka) { User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1") }

    it "本人に固定し、practitioner_id パラメータは無視する" do
      with_admin_token do
        csrf = login_as(tanaka, "password123")
        put "/master/home_layout",
            params: { practitioner_id: "prac-2", definition: { cards: cards } }.to_json,
            headers: json_headers(csrf)
        expect(response).to have_http_status(:ok)
        expect(body["practitioner_id"]).to eq("prac-1")
        expect(HomeLayout.pluck(:practitioner_id)).to eq(["prac-1"])

        get "/master/home_layout", params: { practitioner_id: "prac-2" }
        expect(body["practitioner_id"]).to eq("prac-1")
        expect(body["definition"]["cards"].size).to eq(2)
      end
    end

    it "administrator は 403" do
      with_admin_token do
        csrf = login_as_administrator
        get "/master/home_layout"
        expect(response).to have_http_status(:forbidden)
        put "/master/home_layout", params: { definition: { cards: cards } }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
      end
    end
  end
end
