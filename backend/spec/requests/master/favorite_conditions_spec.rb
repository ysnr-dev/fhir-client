require "rails_helper"

RSpec.describe "Master::FavoriteConditions", type: :request do
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

  let(:disease) { { "id" => 1, "management_number" => "20050001", "name" => "急性上気道炎", "icd10_2013" => "J069", "exchange_code" => "ABCD" } }
  let(:suspected) { { "id" => 0, "management_number" => "27000001", "name" => "の疑い", "exchange_code" => "5395" } }
  let(:definition) { { "schema_version" => 1, "disease" => disease, "prefixModifiers" => [], "postfixModifiers" => [suspected] } }

  describe "GET /master/favorite_conditions" do
    before do
      FavoriteCondition.create!(scope: "facility", name: "共通", definition: definition)
      FavoriteCondition.create!(scope: "department", owner_id: "dept-1", name: "内科", definition: definition)
      FavoriteCondition.create!(scope: "department", owner_id: "dept-2", name: "外科", definition: definition)
      FavoriteCondition.create!(scope: "practitioner", owner_id: "prac-1", name: "自分", definition: definition)
      FavoriteCondition.create!(scope: "practitioner", owner_id: "prac-2", name: "他人", definition: definition)
    end

    it "院内共通 + 指定した診療科 + 指定した医師だけを返す(チームの指定は無視する)" do
      get "/master/favorite_conditions", params: { department_id: "dept-1", practitioner_id: "prac-1", team_id: "team-1" }
      expect(response).to have_http_status(:ok)
      expect(body["items"].map { |i| i["name"] }).to contain_exactly("共通", "内科", "自分")
      expect(body["items"].first["definition"]["disease"]["name"]).to eq("急性上気道炎")
      expect(body["items"].first["definition"]["postfixModifiers"].first["name"]).to eq("の疑い")
    end
  end

  describe "POST /master/favorite_conditions" do
    it "病名と修飾語を保存し、欠けたキーは既定値で埋めて返す" do
      post "/master/favorite_conditions", params: { scope: "facility", name: "急性上気道炎", definition: { "disease" => disease } }, as: :json
      expect(response).to have_http_status(:created), response.body
      expect(body["definition"]).to eq("schema_version" => 1, "disease" => disease, "prefixModifiers" => [], "postfixModifiers" => [])
      expect(body["code"]).to be_present
      expect(body["display_order"]).to eq(1)
    end

    it "病名の無いもの・修飾語の形が違うもの・チームの持ち主は拒否する" do
      post "/master/favorite_conditions", params: { scope: "facility", name: "A", definition: { "prefixModifiers" => [] } }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].to_s).to include("disease")

      post "/master/favorite_conditions",
           params: { scope: "facility", name: "A", definition: { "disease" => disease, "postfixModifiers" => [{ "name" => "の疑い" }] } }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].to_s).to include("postfixModifiers")

      post "/master/favorite_conditions", params: { scope: "team", owner_id: "team-1", name: "A", definition: definition }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "同じ持ち主の中で名前(表示名)は重ならない" do
      FavoriteCondition.create!(scope: "facility", name: "急性上気道炎の疑い", definition: definition)
      post "/master/favorite_conditions", params: { scope: "facility", name: "急性上気道炎の疑い", definition: definition }, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/master/favorite_conditions", params: { scope: "department", owner_id: "dept-1", name: "急性上気道炎の疑い", definition: definition }, as: :json
      expect(response).to have_http_status(:created)
    end
  end

  describe "PATCH / DELETE" do
    let!(:record) { FavoriteCondition.create!(scope: "facility", name: "A", definition: definition) }

    it "名前と中身を更新し、持ち主は付け替えない" do
      patch "/master/favorite_conditions/#{record.id}",
            params: { name: "急性上気道炎", scope: "department", owner_id: "dept-1", definition: { "disease" => disease } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(body["name"]).to eq("急性上気道炎")
      expect(body["scope"]).to eq("facility")
      expect(body["definition"]["postfixModifiers"]).to eq([])
    end

    it "削除できる" do
      delete "/master/favorite_conditions/#{record.id}"
      expect(response).to have_http_status(:no_content)
      expect(FavoriteCondition.count).to eq(0)
    end
  end

  describe "医師スコープの持ち主(ログイン認証あり)" do
    let!(:me) { User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1") }

    it "owner_id はログイン本人で埋まり、他人のものは更新・削除できない" do
      other = FavoriteCondition.create!(scope: "practitioner", owner_id: "prac-2", name: "他人", definition: definition)
      with_admin_token do
        csrf = login_as(me, "password123")
        post "/master/favorite_conditions",
             params: { scope: "practitioner", owner_id: "prac-2", name: "A", definition: definition }.to_json,
             headers: json_headers(csrf)
        expect(response).to have_http_status(:created)
        expect(body["owner_id"]).to eq("prac-1")

        patch "/master/favorite_conditions/#{other.id}", params: { name: "x" }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
        delete "/master/favorite_conditions/#{other.id}", headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
      end
    end
  end
end
