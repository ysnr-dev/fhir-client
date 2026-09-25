require "rails_helper"

RSpec.describe "Master::PatientChartPins", type: :request do
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

  let(:definition) { { "items" => [], "events" => %w[condition] } }
  let!(:diabetes) { ChartDefinition.create!(scope: "facility", name: "糖尿病", definition: definition) }
  let!(:heart) { ChartDefinition.create!(scope: "facility", name: "心不全", definition: definition) }

  it "ピンが無い患者は chart_definition_id が null" do
    get "/master/patient_chart_pins/patient-1"
    expect(response).to have_http_status(:ok)
    expect(body["chart_definition_id"]).to be_nil
  end

  it "ピン留めは患者につき 1 つで、別のチャートにすると置き換わる" do
    put "/master/patient_chart_pins/patient-1", params: { chart_definition_id: diabetes.id }, as: :json
    expect(body["chart_definition_id"]).to eq(diabetes.id)
    put "/master/patient_chart_pins/patient-1", params: { chart_definition_id: heart.id }, as: :json
    expect(body["chart_definition_id"]).to eq(heart.id)
    expect(PatientChartPin.where(patient_id: "patient-1").count).to eq(1)

    get "/master/patient_chart_pins/patient-1"
    expect(body["chart_definition_id"]).to eq(heart.id)
  end

  it "患者ごとに別々に持つ" do
    put "/master/patient_chart_pins/patient-1", params: { chart_definition_id: diabetes.id }, as: :json
    put "/master/patient_chart_pins/patient-2", params: { chart_definition_id: heart.id }, as: :json
    get "/master/patient_chart_pins/patient-1"
    expect(body["chart_definition_id"]).to eq(diabetes.id)
  end

  it "外すと null に戻る" do
    PatientChartPin.create!(patient_id: "patient-1", chart_definition: diabetes)
    delete "/master/patient_chart_pins/patient-1"
    expect(response).to have_http_status(:no_content)
    get "/master/patient_chart_pins/patient-1"
    expect(body["chart_definition_id"]).to be_nil
  end

  it "無いチャートはピン留めできない" do
    put "/master/patient_chart_pins/patient-1", params: { chart_definition_id: 0 }, as: :json
    expect(response).to have_http_status(:not_found)
  end

  it "チャートを消すとピンも外れる" do
    PatientChartPin.create!(patient_id: "patient-1", chart_definition: diabetes)
    delete "/master/chart_definitions/#{diabetes.id}"
    expect(PatientChartPin.exists?(patient_id: "patient-1")).to be(false)
  end

  it "ピン留めした人をログイン本人で記録する" do
    user = User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
    with_admin_token do
      csrf = login_as(user, "password123")
      put "/master/patient_chart_pins/patient-1",
          params: { chart_definition_id: diabetes.id, pinned_by_name: "田中" }.to_json,
          headers: json_headers(csrf)
      expect(response).to have_http_status(:ok)
      expect(body).to include("pinned_by_id" => "prac-1", "pinned_by_name" => "田中")
    end
  end
end
