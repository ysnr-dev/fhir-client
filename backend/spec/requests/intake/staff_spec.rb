require "rails_helper"
require "support/billing_fhir_fixtures"

RSpec.describe "Intake::Staff", type: :request do
  def body = JSON.parse(response.body)

  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  let(:store) { BillingFhirFixtures::FakeStore.new }
  let(:questionnaire_url) { "http://fhir-client.local/Questionnaire/intake-general-01" }

  before do
    store.add(
      { "resourceType" => "Patient", "id" => "pat-1", "birthDate" => "1990-01-01" },
      { "resourceType" => "Appointment", "id" => "apt-1", "status" => "booked", "start" => "2026-10-20T09:30:00+09:00",
        "participant" => [{ "actor" => { "reference" => "Patient/pat-1" } }],
        "specialty" => [{ "coding" => [{ "system" => "urn:oid:1.2.392.100495.20.2.51", "code" => "01" }] }] }
    )
    allow(Integrations::FhirStore).to receive(:new).and_return(store)
    FacilitySettings.current.update!(settings: { "intake" => { "questionnaires" => [questionnaire_url] } })
  end

  describe "POST /intake/links" do
    it "予約から患者・生年月日・質問票を決めてリンクを発行し、トークンは応答にだけ出す" do
      travel_to Time.zone.parse("2026-10-16 10:00:00 +09:00") do
        with_admin_token(nil) { post "/intake/links", params: { appointment_id: "apt-1" }, as: :json }
      end

      expect(response).to have_http_status(:created)
      expect(body["path"]).to match(%r{\A/q/[A-Za-z0-9_-]{40,}\z})
      expect(body["questionnaire_urls"]).to eq([questionnaire_url])
      # 予約日の翌日の終わり(日本時間)
      expect(Time.iso8601(body["expires_at"]).in_time_zone("Asia/Tokyo").strftime("%F %H:%M")).to eq("2026-10-21 23:59")

      link = IntakeLink.last
      expect(link.patient_fhir_id).to eq("pat-1")
      expect(link.birth_date).to eq("1990-01-01")
      expect(link.token_digest).not_to include(body["path"].delete_prefix("/q/"))
      expect(IntakeLink.find_by_token(body["path"].delete_prefix("/q/"))).to eq(link)
    end

    it "診療科の質問票が設定されていればそちらを使い、発行し直すと前のリンクは無効になる" do
      FacilitySettings.current.update!(settings: { "intake" => { "questionnaires" => [questionnaire_url],
                                                                 "by_department" => { "01" => ["http://fhir-client.local/Questionnaire/intake-internal-01"] } } })
      with_admin_token(nil) do
        post "/intake/links", params: { appointment_id: "apt-1" }, as: :json
        first = IntakeLink.last
        post "/intake/links", params: { appointment_id: "apt-1" }, as: :json
        expect(body["questionnaire_urls"]).to eq(["http://fhir-client.local/Questionnaire/intake-internal-01"])
        expect(first.reload.revoked_at).to be_present
        expect(IntakeLink.active.where(appointment_fhir_id: "apt-1").count).to eq(1)
      end
    end

    it "質問票が決まらなければ 422、ログインしていなければ 401" do
      FacilitySettings.current.update!(settings: {})
      with_admin_token(nil) { post "/intake/links", params: { patient_id: "pat-1" }, as: :json }
      expect(response).to have_http_status(:unprocessable_content)

      with_admin_token("s3cret") { post "/intake/links", params: { patient_id: "pat-1" }, as: :json }
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "GET /intake/links と回答の取込" do
    it "予約ごとの状態を返し、回答の取込で imported になる" do
      link, = IntakeLink.issue!(appointment_fhir_id: "apt-1", patient_fhir_id: "pat-1", questionnaire_urls: [questionnaire_url],
                                birth_date: "1990-01-01", expires_at: 1.day.from_now)
      with_admin_token(nil) { get "/intake/links", params: { appointment_ids: "apt-1,apt-x" } }
      expect(body["items"]).to eq([{ "appointment_fhir_id" => "apt-1", "status" => "issued", "expires_at" => link.expires_at.iso8601 }])

      answer = link.responses.create!(questionnaire_url: questionnaire_url, answers: [{ "linkId" => "chief", "answer" => [{ "valueString" => "頭痛" }] }],
                                      submitted_at: Time.current)
      with_admin_token(nil) do
        get "/intake/links", params: { appointment_ids: "apt-1" }
        expect(body["items"][0]["status"]).to eq("answered")

        get "/intake/responses", params: { patient_id: "pat-1" }
        expect(body["items"].map { |i| i["id"] }).to eq([answer.id])
        expect(body["items"][0]["answers"]).to eq([{ "linkId" => "chief", "answer" => [{ "valueString" => "頭痛" }] }])

        patch "/intake/responses/#{answer.id}", params: { status: "imported", imported_qr_id: "qr-1" }, as: :json
        expect(response).to have_http_status(:ok)
        expect(answer.reload).to have_attributes(status: "imported", imported_qr_id: "qr-1")

        get "/intake/links", params: { appointment_ids: "apt-1" }
        expect(body["items"][0]["status"]).to eq("imported")

        get "/intake/responses", params: { patient_id: "pat-1" }
        expect(body["items"]).to eq([])
      end
    end
  end
end
