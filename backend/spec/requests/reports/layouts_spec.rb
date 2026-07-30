require "rails_helper"

RSpec.describe "Reports::Layouts", type: :request do
  describe "GET /reports/layouts" do
    let(:tlf) { { version: "0.11.0", items: [] }.to_json }

    it "returns registered: true with metadata when a layout exists" do
      layout = ReportLayout.create!(
        name: "問診票",
        questionnaire_url: "http://example.com/Questionnaire/intake",
        questionnaire_version: "1.0.0",
        tlf: tlf
      )

      get "/reports/layouts",
          params: { canonical: "http://example.com/Questionnaire/intake|1.0.0" }

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["registered"]).to be(true)
      expect(body["name"]).to eq("問診票")
      expect(body["updated_at"]).to eq(layout.updated_at.as_json)
    end

    it "matches a version-less canonical" do
      ReportLayout.create!(
        name: "問診票",
        questionnaire_url: "http://example.com/Questionnaire/intake",
        questionnaire_version: "",
        tlf: tlf
      )

      get "/reports/layouts", params: { canonical: "http://example.com/Questionnaire/intake" }

      expect(response.parsed_body["registered"]).to be(true)
    end

    it "returns registered: false when no layout matches" do
      get "/reports/layouts", params: { canonical: "http://example.com/Questionnaire/none|1.0.0" }

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["registered"]).to be(false)
    end

    it "returns registered: false for a blank canonical" do
      get "/reports/layouts"

      expect(response.parsed_body["registered"]).to be(false)
    end
  end
end
