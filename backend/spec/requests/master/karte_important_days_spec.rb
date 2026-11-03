require "rails_helper"

RSpec.describe "Master::KarteImportantDays", type: :request do
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

  it "重要日の無い患者は空の配列" do
    get "/master/karte_important_days", params: { patient_id: "patient-1" }
    expect(response).to have_http_status(:ok)
    expect(body).to eq([])
  end

  it "patient_id が無ければ 400" do
    get "/master/karte_important_days"
    expect(response).to have_http_status(:bad_request)
  end

  it "設定は患者と日につき 1 つで、同じ日に設定し直すと置き換わる" do
    put "/master/karte_important_days/2026-11-03",
        params: { patient_id: "patient-1", severity: "high", comment: " 手術日 " }, as: :json
    expect(response).to have_http_status(:ok)
    expect(body).to include("day" => "2026-11-03", "severity" => "high", "comment" => "手術日")

    put "/master/karte_important_days/2026-11-03",
        params: { patient_id: "patient-1", severity: "low", comment: "" }, as: :json
    expect(body).to include("severity" => "low", "comment" => nil)
    expect(KarteImportantDay.where(patient_id: "patient-1").count).to eq(1)
  end

  it "一覧は患者ごとに日付順" do
    put "/master/karte_important_days/2026-11-10", params: { patient_id: "patient-1", severity: "medium" }, as: :json
    put "/master/karte_important_days/2026-11-03", params: { patient_id: "patient-1", severity: "high" }, as: :json
    put "/master/karte_important_days/2026-11-03", params: { patient_id: "patient-2", severity: "low" }, as: :json
    get "/master/karte_important_days", params: { patient_id: "patient-1" }
    expect(body.map { |row| row["day"] }).to eq(%w[2026-11-03 2026-11-10])
    expect(body.map { |row| row["severity"] }).to eq(%w[high medium])
  end

  it "知らない重要度は 422" do
    put "/master/karte_important_days/2026-11-03", params: { patient_id: "patient-1", severity: "urgent" }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "解除すると一覧から消える" do
    KarteImportantDay.create!(patient_id: "patient-1", day: "2026-11-03", severity: "high")
    delete "/master/karte_important_days/2026-11-03", params: { patient_id: "patient-1" }
    expect(response).to have_http_status(:no_content)
    get "/master/karte_important_days", params: { patient_id: "patient-1" }
    expect(body).to eq([])
  end

  it "設定した人をログイン本人で記録する" do
    user = User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
    with_admin_token do
      csrf = login_as(user, "password123")
      put "/master/karte_important_days/2026-11-03",
          params: { patient_id: "patient-1", severity: "high", set_by_name: "田中" }.to_json,
          headers: json_headers(csrf)
      expect(response).to have_http_status(:ok)
      expect(body).to include("set_by_id" => "prac-1", "set_by_name" => "田中")
    end
  end
end
