require "rails_helper"

RSpec.describe "Master::ChartDefinitions", type: :request do
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
    {
      "schema_version" => 1,
      "axis" => { "unit" => "month", "columns" => 12 },
      "items" => [
        { "key" => "lab:0001", "source" => "lab", "name" => "WBC", "unit" => "10*3/uL",
          "codings" => [{ "system" => "http://example.org/lab", "code" => "0001", "display" => "WBC" }] },
        { "key" => "vital:85354-9", "source" => "vital", "name" => "血圧", "unit" => "mmHg",
          "codings" => [{ "system" => "http://loinc.org", "code" => "85354-9" }],
          "components" => [{ "code" => "8480-6", "name" => "収縮期" }, { "code" => "8462-4", "name" => "拡張期" }] }
      ],
      "events" => %w[encounter surgery],
      "drugs" => [{ "key" => "yj7:3332001", "name" => "ワルファリン", "yj7" => "3332001", "codes" => ["613330003"] }],
      "overlay" => true,
      "background" => { "kind" => "drug", "key" => "yj7:3332001" }
    }
  end

  describe "GET /master/chart_definitions" do
    before do
      ChartDefinition.create!(scope: "facility", name: "共通", definition: definition)
      ChartDefinition.create!(scope: "department", owner_id: "dept-1", name: "内科", definition: definition)
      ChartDefinition.create!(scope: "department", owner_id: "dept-2", name: "外科", definition: definition)
      ChartDefinition.create!(scope: "practitioner", owner_id: "prac-1", name: "自分", definition: definition)
      ChartDefinition.create!(scope: "practitioner", owner_id: "prac-2", name: "他人", definition: definition)
    end

    it "院内共通 + 指定した診療科 + 指定した医師だけを返す" do
      get "/master/chart_definitions", params: { department_id: "dept-1", practitioner_id: "prac-1" }
      expect(response).to have_http_status(:ok)
      expect(body["items"].map { |i| i["name"] }).to contain_exactly("共通", "内科", "自分")
    end

    it "指定が無ければ院内共通だけになる" do
      get "/master/chart_definitions"
      expect(body["items"].map { |i| i["name"] }).to eq(["共通"])
    end

    it "definition を添えて返す" do
      get "/master/chart_definitions"
      expect(body["items"].first["definition"]["items"].map { |i| i["key"] }).to eq(["lab:0001", "vital:85354-9"])
    end
  end

  describe "POST /master/chart_definitions" do
    it "ネストした definition をそのまま保存する" do
      post "/master/chart_definitions",
           params: { scope: "facility", name: "血算", definition: definition }, as: :json
      expect(response).to have_http_status(:created)
      expect(body["definition"]).to eq(definition)
      expect(ChartDefinition.find(body["id"]).definition).to eq(definition)
    end

    it "display_order を持ち主ごとの末尾に採番する" do
      post "/master/chart_definitions", params: { scope: "facility", name: "A", definition: definition }, as: :json
      post "/master/chart_definitions", params: { scope: "facility", name: "B", definition: definition }, as: :json
      expect(ChartDefinition.ordered.pluck(:name, :display_order)).to eq([["A", 1], ["B", 2]])
    end

    it "壊れた definition は 422" do
      post "/master/chart_definitions",
           params: { scope: "facility", name: "A",
                     definition: definition.merge("axis" => { "unit" => "week", "columns" => 4 }) },
           as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(ChartDefinition.count).to eq(0)
    end

    it "院内共通に owner_id を付けると 422" do
      post "/master/chart_definitions",
           params: { scope: "facility", owner_id: "x", name: "A", definition: definition }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /master/chart_definitions/:id" do
    it "名前と definition は変えられるが持ち主は変わらない" do
      record = ChartDefinition.create!(scope: "department", owner_id: "dept-1", name: "A", definition: definition)
      patch "/master/chart_definitions/#{record.id}",
            params: { name: "B", scope: "facility", owner_id: "dept-2",
                      definition: definition.merge("events" => ["chemo"]) },
            as: :json
      expect(response).to have_http_status(:ok)
      expect(body["name"]).to eq("B")
      expect(body["scope"]).to eq("department")
      expect(body["owner_id"]).to eq("dept-1")
      expect(body["definition"]["events"]).to eq(["chemo"])
    end
  end

  describe "DELETE /master/chart_definitions/:id" do
    it "消える" do
      record = ChartDefinition.create!(scope: "facility", name: "A", definition: definition)
      delete "/master/chart_definitions/#{record.id}"
      expect(response).to have_http_status(:no_content)
      expect(ChartDefinition.count).to eq(0)
    end
  end

  describe "医師スコープの持ち主(ログイン認証あり)" do
    let!(:me) { User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1") }
    let!(:other) { User.create!(login_id: "suzuki", password: "password123", practitioner_fhir_id: "prac-2") }

    it "owner_id はパラメータではなくログイン本人で埋まる" do
      with_admin_token do
        csrf = login_as(me, "password123")
        post "/master/chart_definitions",
             params: { scope: "practitioner", owner_id: "prac-2", name: "A", definition: definition }.to_json,
             headers: json_headers(csrf)
        expect(response).to have_http_status(:created)
        expect(body["owner_id"]).to eq("prac-1")
      end
    end

    it "他人の医師チャートは更新・削除できない(読み取りはできる)" do
      record = ChartDefinition.create!(scope: "practitioner", owner_id: "prac-2", name: "他人", definition: definition)
      with_admin_token do
        csrf = login_as(me, "password123")
        get "/master/chart_definitions/#{record.id}"
        expect(response).to have_http_status(:ok)
        patch "/master/chart_definitions/#{record.id}", params: { name: "x" }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
        delete "/master/chart_definitions/#{record.id}", headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
        csrf = login_as(other, "password123")
        patch "/master/chart_definitions/#{record.id}", params: { name: "x" }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:ok)
      end
    end

    it "administrator は医師チャートを作れない" do
      with_admin_token do
        post "/auth/session", params: { login_id: "administrator", password: admin_token }, as: :json
        csrf = JSON.parse(response.body).fetch("csrf_token")
        post "/master/chart_definitions",
             params: { scope: "practitioner", name: "A", definition: definition }.to_json,
             headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
      end
    end
  end
end
