require "rails_helper"

RSpec.describe "Master::AdvisoryRules", type: :request do
  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  def rule(code, **attrs)
    Master::AdvisoryRule.create!(code: code, name: code, severity: "info", contexts: ["prescription"],
                                 expression: "%age >= 75", message: "高齢", **attrs)
  end

  let(:payload) do
    { code: "egfr-low", name: "腎機能低下", severity: "warning", contexts: %w[prescription injection],
      expression: "%egfr < 30", message: "eGFR 30 未満です", basis: "https://example.org/guideline" }
  end

  it "lists rules in display order and filters by enabled and context" do
    rule("c", display_order: 30)
    rule("b", display_order: 20, enabled: false)
    rule("a", display_order: 10, contexts: %w[patient-view injection])

    with_admin_token(nil) { get "/master/advisory_rules" }
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["items"].map { |i| i["code"] }).to eq(%w[a b c])

    with_admin_token(nil) { get "/master/advisory_rules", params: { enabled: "true" } }
    expect(response.parsed_body["items"].map { |i| i["code"] }).to eq(%w[a c])

    with_admin_token(nil) { get "/master/advisory_rules", params: { context: "injection" } }
    expect(response.parsed_body["items"].map { |i| i["code"] }).to eq(%w[a])
  end

  it "creates a rule with contexts and keeps the code on update" do
    with_admin_token(nil) { post "/master/advisory_rules", params: payload, as: :json }
    expect(response).to have_http_status(:created)
    expect(response.parsed_body["contexts"]).to eq(%w[prescription injection])

    with_admin_token(nil) do
      patch "/master/advisory_rules/egfr-low", params: { code: "renamed", severity: "info", contexts: ["patient-view"] }, as: :json
    end
    expect(response).to have_http_status(:ok)
    record = Master::AdvisoryRule.find_by(code: "egfr-low")
    expect(record.severity).to eq("info")
    expect(record.contexts).to eq(["patient-view"])
  end

  it "rejects block severity, unknown or empty contexts and a bad code" do
    [
      payload.merge(severity: "block"),
      payload.merge(contexts: ["unknown-form"]),
      payload.merge(contexts: []),
      payload.merge(code: "Bad Code"),
      payload.merge(expression: "")
    ].each do |body|
      with_admin_token(nil) { post "/master/advisory_rules", params: body, as: :json }
      expect(response).to have_http_status(:unprocessable_content), body.inspect
    end
  end
end
