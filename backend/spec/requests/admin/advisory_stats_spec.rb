require "rails_helper"

RSpec.describe "Admin::AdvisoryStats", type: :request do
  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  def event(session, key, outcome, at, kind: "allergy", reason: nil)
    AdvisoryEvent.create!(session_id: session, advisory_key: key, kind: kind, severity: "warning", outcome: outcome,
                          context: "prescription", reason_code: reason, occurred_at: Time.zone.parse(at))
  end

  it "groups by kind and Japan-time month with reason counts" do
    # 日本時間 9 月 30 日 23:30 は UTC では 9 月 30 日 14:30、10 月 1 日 00:30 は UTC の 9 月 30 日 15:30。
    event("s1", "a", "fired", "2026-09-30T23:30:00+09:00")
    event("s1", "a", "overridden", "2026-09-30T23:30:00+09:00", reason: "monitored")
    event("s2", "a", "fired", "2026-10-01T00:30:00+09:00")
    event("s2", "a", "overridden", "2026-10-01T00:30:00+09:00", reason: "other")
    event("s3", "b", "fired", "2026-10-05T10:00:00+09:00", kind: "duplicate")
    event("s4", "a", "overridden", "2026-10-06T10:00:00+09:00", reason: "other")

    with_admin_token(nil) { get "/admin/advisory_stats", params: { from: "2026-09", to: "2026-10" } }

    expect(response).to have_http_status(:ok)
    body = response.parsed_body
    expect(body["from"]).to eq("2026-09")
    expect(body["rows"]).to eq([
      { "kind" => "allergy", "month" => "2026-09", "fired" => 1, "overridden" => 1, "reasons" => { "monitored" => 1 } },
      { "kind" => "allergy", "month" => "2026-10", "fired" => 1, "overridden" => 2, "reasons" => { "other" => 2 } },
      { "kind" => "duplicate", "month" => "2026-10", "fired" => 1, "overridden" => 0, "reasons" => {} }
    ])
  end

  it "defaults to the last six months and rejects an inverted or too long range" do
    with_admin_token(nil) { get "/admin/advisory_stats" }
    expect(response).to have_http_status(:ok)
    to = Date.strptime(response.parsed_body["to"], "%Y-%m")
    expect(Date.strptime(response.parsed_body["from"], "%Y-%m")).to eq(to << 5)

    with_admin_token(nil) { get "/admin/advisory_stats", params: { from: "2026-10", to: "2026-09" } }
    expect(response).to have_http_status(:bad_request)

    with_admin_token(nil) { get "/admin/advisory_stats", params: { from: "2024-01", to: "2026-10" } }
    expect(response).to have_http_status(:bad_request)
  end
end
