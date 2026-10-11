require "rails_helper"

RSpec.describe "Master::Dashboards", type: :request do
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

  def json_headers(csrf)
    { "CONTENT_TYPE" => "application/json", "X-CSRF-Token" => csrf }
  end

  def body = JSON.parse(response.body)

  let(:definition) do
    { "schema_version" => 1, "tiles" => [tile("t1", x: 0, y: 0, title: nil), tile("t2", x: 3, y: 0, w: 9, h: 4, view: "breakdown")] }
  end

  def tile(id, x:, y:, w: 3, h: 2, view: "count", title: "タイル")
    base = { "id" => id, "query_code" => "q-#{id}", "view" => view, "x" => x, "y" => y, "w" => w, "h" => h }
    title ? base.merge("title" => title) : base
  end

  describe "GET /master/dashboards" do
    before do
      Dashboard.create!(scope: "facility", name: "共通", definition: definition)
      Dashboard.create!(scope: "department", owner_id: "dept-1", name: "内科", definition: definition)
      Dashboard.create!(scope: "department", owner_id: "dept-2", name: "外科", definition: definition)
      Dashboard.create!(scope: "practitioner", owner_id: "prac-1", name: "自分", definition: definition)
      Dashboard.create!(scope: "practitioner", owner_id: "prac-2", name: "他人", definition: definition)
      Dashboard.create!(scope: "team", owner_id: "team-1", name: "NST", definition: definition)
    end

    it "院内共通 + 指定した診療科 + 指定した医師 + チームだけを返す" do
      get "/master/dashboards", params: { department_id: "dept-1", practitioner_id: "prac-1", team_id: "team-1" }
      expect(response).to have_http_status(:ok)
      expect(body["items"].map { |i| i["name"] }).to contain_exactly("共通", "内科", "自分", "NST")
      expect(body["items"].first["definition"]["tiles"].size).to eq(2)
    end
  end

  describe "POST /master/dashboards" do
    it "タイルの並びを保存し、欠けたキーは既定値で埋めて返す" do
      post "/master/dashboards", params: { scope: "facility", name: "A", definition: { "tiles" => [tile("t1", x: 0, y: 0)] } }, as: :json
      expect(response).to have_http_status(:created), response.body
      expect(body["definition"]).to eq("schema_version" => 1, "tiles" => [tile("t1", x: 0, y: 0)])
      expect(body["code"]).to be_present
    end

    it "右端をはみ出すタイル・知らない表示・重なった id は拒否する" do
      post "/master/dashboards", params: { scope: "facility", name: "A", definition: { "tiles" => [tile("t1", x: 10, y: 0, w: 3)] } }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].to_s).to include("はみ出")

      post "/master/dashboards", params: { scope: "facility", name: "A", definition: { "tiles" => [tile("t1", x: 0, y: 0, view: "chart")] } }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/master/dashboards", params: { scope: "facility", name: "A", definition: { "tiles" => [tile("t1", x: 0, y: 0), tile("t1", x: 3, y: 0)] } }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "同じ持ち主の中で名前は重ならない" do
      Dashboard.create!(scope: "facility", name: "A", definition: definition)
      post "/master/dashboards", params: { scope: "facility", name: "A", definition: definition }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH / DELETE" do
    let!(:record) { Dashboard.create!(scope: "facility", name: "A", definition: definition) }

    it "名前と並びを更新し、持ち主は付け替えない" do
      patch "/master/dashboards/#{record.id}",
            params: { name: "B", scope: "department", owner_id: "dept-1", definition: { "tiles" => [] } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(body["name"]).to eq("B")
      expect(body["scope"]).to eq("facility")
      expect(body["definition"]["tiles"]).to eq([])
    end

    it "削除できる" do
      delete "/master/dashboards/#{record.id}"
      expect(response).to have_http_status(:no_content)
      expect(Dashboard.count).to eq(0)
    end
  end

  describe "医師スコープの持ち主(ログイン認証あり)" do
    let!(:me) { User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1") }

    it "owner_id はログイン本人で埋まり、他人のものは更新・削除できない" do
      other = Dashboard.create!(scope: "practitioner", owner_id: "prac-2", name: "他人", definition: definition)
      with_admin_token do
        csrf = login_as(me, "password123")
        post "/master/dashboards",
             params: { scope: "practitioner", owner_id: "prac-2", name: "A", definition: definition }.to_json,
             headers: json_headers(csrf)
        expect(response).to have_http_status(:created)
        expect(body["owner_id"]).to eq("prac-1")

        patch "/master/dashboards/#{other.id}", params: { name: "x" }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
        delete "/master/dashboards/#{other.id}", headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
      end
    end
  end
end
