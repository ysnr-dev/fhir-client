require "rails_helper"
require "support/billing_fhir_fixtures"

RSpec.describe "Intake::Public", type: :request do
  def body = JSON.parse(response.body)

  let(:store) { BillingFhirFixtures::FakeStore.new }
  let(:questionnaire_url) { "http://fhir-client.local/Questionnaire/intake-general-01" }
  let(:questionnaire) do
    { "resourceType" => "Questionnaire", "id" => "q-1", "url" => questionnaire_url, "version" => "1.0.0", "status" => "active",
      "item" => [{ "linkId" => "chief", "type" => "string", "text" => "主訴" }] }
  end
  let!(:issued) do
    IntakeLink.issue!(appointment_fhir_id: "apt-1", patient_fhir_id: "pat-1", questionnaire_urls: [questionnaire_url],
                      birth_date: "1990-01-01", expires_at: 1.day.from_now)
  end
  let(:link) { issued[0] }
  let(:headers) { { "X-Intake-Token" => issued[1] } }

  before do
    store.add(questionnaire)
    allow(Integrations::FhirStore).to receive(:new).and_return(store)
    Intake::PublicController::RATE_LIMIT_STORE.clear
  end

  it "トークンが無い・違えば 401" do
    get "/intake/public"
    expect(response).to have_http_status(:unauthorized)
    get "/intake/public", headers: { "X-Intake-Token" => "bogus" }
    expect(response).to have_http_status(:unauthorized)
  end

  it "照合前は verify。生年月日が合えば ready になり、質問票が付く。応答に個人情報は入らない" do
    get "/intake/public", headers: headers
    expect(body).to eq("status" => "verify", "submitted_urls" => [])

    post "/intake/public/verify", params: { birth_date: "1990-01-02" }, headers: headers, as: :json
    expect(response).to have_http_status(:forbidden)
    expect(body["status"]).to eq("verify")

    post "/intake/public/verify", params: { birth_date: "1990-01-01" }, headers: headers, as: :json
    expect(response).to have_http_status(:ok)

    get "/intake/public", headers: headers
    expect(body["status"]).to eq("ready")
    expect(body["questionnaires"].map { |q| q["url"] }).to eq([questionnaire_url])
    expect(response.body).not_to include("1990-01-01")
    expect(response.body).not_to include("pat-1")
  end

  it "5 回間違えると locked になり、正しい生年月日でも通らない" do
    5.times { post "/intake/public/verify", params: { birth_date: "2000-01-01" }, headers: headers, as: :json }
    expect(body["status"]).to eq("locked")

    post "/intake/public/verify", params: { birth_date: "1990-01-01" }, headers: headers, as: :json
    expect(response).to have_http_status(:forbidden)
    expect(body["status"]).to eq("locked")
  end

  it "期限切れは 410" do
    travel_to 2.days.from_now do
      get "/intake/public", headers: headers
      expect(body["status"]).to eq("expired")
      post "/intake/public/verify", params: { birth_date: "1990-01-01" }, headers: headers, as: :json
      expect(response).to have_http_status(:gone)
    end
  end

  it "照合前の回答は 403。照合後は保存でき、同じ質問票は上書きされる" do
    answers = [{ "linkId" => "chief", "answer" => [{ "valueString" => "頭痛" }] }]
    post "/intake/public/responses", params: { questionnaire_url: questionnaire_url, answers: answers }, headers: headers, as: :json
    expect(response).to have_http_status(:forbidden)

    link.update!(verified_at: Time.current)
    # 患者画面は開いた版の canonical を送る。リンクの url(版なし)と url の部分で突き合わせる。
    post "/intake/public/responses", params: { questionnaire_url: "#{questionnaire_url}|1.0.0", questionnaire_version: "1.0.0", answers: answers },
                                     headers: headers, as: :json
    expect(response).to have_http_status(:created)
    expect(body["submitted_urls"]).to eq(["#{questionnaire_url}|1.0.0"])

    post "/intake/public/responses", params: { questionnaire_url: questionnaire_url,
                                               answers: [{ "linkId" => "chief", "answer" => [{ "valueString" => "腹痛" }] }] },
                                     headers: headers, as: :json
    expect(link.responses.count).to eq(1)
    expect(link.responses.first.answers.dig(0, "answer", 0, "valueString")).to eq("腹痛")

    post "/intake/public/responses", params: { questionnaire_url: "http://other", answers: [] }, headers: headers, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end
end
