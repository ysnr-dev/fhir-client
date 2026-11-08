require "rails_helper"

RSpec.describe "Reports::DischargeSummaryPdfs", type: :request do
  let(:upstream_base) { ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000") }

  let(:composition) do
    {
      "resourceType" => "Composition", "id" => "c1", "status" => "final",
      "type" => { "coding" => [{ "system" => "http://loinc.org", "code" => "18842-5" }] },
      "subject" => { "reference" => "Patient/p1" },
      "section" => [{ "title" => "入院経過",
                      "text" => { "div" => '<div xmlns="http://www.w3.org/1999/xhtml"><p>09/17 退院</p></div>' } }]
    }
  end
  let(:patient) do
    { "resourceType" => "Patient", "id" => "p1", "name" => [{ "family" => "テスト", "given" => ["太郎"] }] }
  end

  def stub_upstream(composition_body)
    stub_request(:post, "#{upstream_base}/").to_return(
      status: 200,
      headers: { "Content-Type" => "application/fhir+json" },
      body: {
        "resourceType" => "Bundle", "type" => "batch-response",
        "entry" => [
          { "response" => { "status" => "200 OK" },
            "resource" => { "resourceType" => "Bundle", "type" => "searchset",
                            "entry" => [composition_body, patient].map { |r| { "resource" => r } } } },
          { "response" => { "status" => "404" } }
        ]
      }.to_json
    )
  end

  it "returns the summary as an inline PDF" do
    stub_upstream(composition)
    get "/reports/discharge_summaries/c1/pdf"

    expect(response).to have_http_status(:ok)
    expect(response.content_type).to eq("application/pdf")
    expect(response.headers["Content-Disposition"]).to include("inline")
    expect(PDF::Inspector::Text.analyze(response.body).strings.join.tr("\u00A0", " ")).to include("09/17 退院")
  end

  it "returns 422 for a draft" do
    stub_upstream(composition.merge("status" => "preliminary"))
    get "/reports/discharge_summaries/c1/pdf"

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["error"]).to eq("discharge_summary_draft")
  end
end
