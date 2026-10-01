require "rails_helper"

RSpec.describe "Reports::DpcForm1", type: :request do
  let(:upstream_base) { ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000") }

  let(:encounter) do
    {
      "resourceType" => "Encounter", "id" => "enc-1", "status" => "finished",
      "subject" => { "reference" => "Patient/pat-1", "display" => "テスト 太郎" },
      "period" => { "start" => "2026-09-01T10:00:00+09:00", "end" => "2026-09-17T22:28:00+09:00" }
    }
  end

  def answer(link_id, value)
    { "linkId" => link_id, "answer" => [{ "valueString" => value }] }
  end

  def questionnaire_response(status: "completed")
    {
      "resourceType" => "QuestionnaireResponse", "id" => "qr-1",
      "questionnaire" => DpcForm1Export::QUESTIONNAIRE_URL,
      "status" => status,
      "encounter" => { "reference" => "Encounter/enc-1" },
      "item" => [
        { "linkId" => "header",
          "item" => [answer("header.facility", "131234567"), answer("header.dataId", "0011223344"),
                     answer("header.admitDate", "20260901"), answer("header.count", "0"),
                     answer("header.summaryNo", "0")] },
        { "linkId" => "A006010",
          "item" => [answer("A006010.ver", "20140401"), answer("A006010.seq", "0"),
                     answer("A006010.p2", "C169"), answer("A006010.p9", "胃癌")] }
      ]
    }
  end

  def searchset(resources)
    { "resourceType" => "Bundle", "type" => "searchset",
      "entry" => resources.map { |r| { "resource" => r } } }.to_json
  end

  def stub_upstream(responses: [questionnaire_response], status: 200)
    stub_request(:get, "#{upstream_base}/Encounter")
      .with(query: hash_including("class" => "IMP"))
      .to_return(status: status, body: searchset([encounter]))
    stub_request(:get, "#{upstream_base}/QuestionnaireResponse")
      .with(query: hash_including("encounter" => "Encounter/enc-1"))
      .to_return(status: 200, body: searchset(responses))
  end

  describe "GET /reports/dpc_form1" do
    it "returns the encounters of the month with their form1 status" do
      stub_upstream

      get "/reports/dpc_form1", params: { month: "2026-09" }

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq(
        "month" => "2026-09",
        "filename" => "FF1_131234567_2609.txt",
        "facility_code" => "131234567",
        "encounters" => [
          { "encounter_id" => "enc-1", "patient_id" => "pat-1", "patient_display" => "テスト 太郎",
            "admit_date" => "2026-09-01", "discharge_date" => "2026-09-17",
            "form1_status" => "completed", "questionnaire_response_id" => "qr-1" }
        ],
        "warnings" => [],
        "exported_count" => 1,
        "excluded_count" => 0,
        "record_count" => 1
      )
    end

    it "returns 422 for a malformed month" do
      get "/reports/dpc_form1", params: { month: "2026/09" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("error" => "invalid_month")
    end

    it "returns 422 when month is missing" do
      get "/reports/dpc_form1"

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "returns 502 when the upstream fails" do
      stub_upstream(status: 500)

      get "/reports/dpc_form1", params: { month: "2026-09" }

      expect(response).to have_http_status(:bad_gateway)
      expect(response.parsed_body).to eq("error" => "upstream_unreachable")
    end
  end

  describe "GET /reports/dpc_form1/file" do
    it "sends the Shift_JIS file as an attachment" do
      stub_upstream

      get "/reports/dpc_form1/file", params: { month: "2026-09" }

      expect(response).to have_http_status(:ok)
      expect(response.media_type).to eq("text/plain")
      expect(response.headers["Content-Disposition"]).to include("attachment")
      expect(response.headers["Content-Disposition"]).to include("FF1_131234567_2609.txt")
      lines = response.body.b.split("\r\n".b)
      expect(lines.size).to eq(2)
      expect(lines.last).to eq(
        "131234567\t0011223344\t20260901\t0\t0\tA006010\t20140401\t0\t\tC169\t\t\t\t\t\t\t\x88\xDD\x8A\xE0".b
      )
    end

    it "returns 422 when no form1 is completed" do
      stub_upstream(responses: [questionnaire_response(status: "in-progress")])

      get "/reports/dpc_form1/file", params: { month: "2026-09" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to eq("error" => "no_exportable_form1")
    end

    it "returns 422 for a malformed month" do
      get "/reports/dpc_form1/file", params: { month: "abc" }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
