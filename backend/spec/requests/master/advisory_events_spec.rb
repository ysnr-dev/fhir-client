require "rails_helper"

RSpec.describe "Master::AdvisoryEvents", type: :request do
  let(:admin_token) { "s3cret-admin-passphrase" }

  def with_admin_token(token = admin_token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  def login_as_practitioner
    User.find_or_create_by!(login_id: "tanaka") { |u| u.password = "password123"; u.practitioner_fhir_id = "prac-1" }
    post "/auth/session", params: { login_id: "tanaka", password: "password123" }, as: :json
    response.parsed_body["csrf_token"]
  end

  let(:payload) do
    {
      context: "prescription",
      session_id: "s-1",
      events: [
        { key: "allergy|1234|ペニシリン", kind: "allergy", severity: "warning", outcome: "fired", occurred_at: "2026-10-18T10:00:00+09:00" },
        { key: "allergy|1234|ペニシリン", kind: "allergy", severity: "warning", outcome: "overridden",
          reason_code: "monitored", reason_text: "入院中", occurred_at: "2026-10-18T10:05:00+09:00" },
        { key: "duplicate|5678|同成分", kind: "duplicate", severity: "info", outcome: "fired" }
      ]
    }
  end

  it "records the batch as the logged-in practitioner and ignores a resend" do
    with_admin_token do
      csrf = login_as_practitioner
      post "/master/advisory_events", params: payload, headers: { "X-CSRF-Token" => csrf }, as: :json
      expect(response).to have_http_status(:no_content)
      expect(AdvisoryEvent.count).to eq(3)

      overridden = AdvisoryEvent.find_by(outcome: "overridden")
      expect(overridden).to have_attributes(kind: "allergy", context: "prescription", reason_code: "monitored",
                                            reason_text: "入院中", practitioner_fhir_id: "prac-1", user_login_id: "tanaka")
      expect(overridden.occurred_at).to eq(Time.zone.parse("2026-10-18T10:05:00+09:00"))

      post "/master/advisory_events", params: payload, headers: { "X-CSRF-Token" => csrf }, as: :json
      expect(response).to have_http_status(:no_content)
      expect(AdvisoryEvent.count).to eq(3)
    end
  end

  it "rejects a bad outcome and a request without the CSRF token" do
    with_admin_token do
      csrf = login_as_practitioner
      bad = payload.merge(events: [{ key: "k", kind: "allergy", severity: "warning", outcome: "ignored" }])
      post "/master/advisory_events", params: bad, headers: { "X-CSRF-Token" => csrf }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(AdvisoryEvent.count).to eq(0)

      post "/master/advisory_events", params: payload, as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  it "accepts an empty batch without the token" do
    with_admin_token(nil) { post "/master/advisory_events", params: payload.merge(events: []), as: :json }
    expect(response).to have_http_status(:no_content)
  end
end
