require "rails_helper"

# ルーティングと、帳票の例外 → HTTP 応答の対応を見る(中身の組み立ては RegimenMasterReport の spec)。
RSpec.describe "Reports::RegimenMasterPdfs", type: :request do
  let(:report) { instance_double(RegimenMasterReport) }

  before { allow(RegimenMasterReport).to receive(:new).with("5").and_return(report) }

  it "returns the regimen inline" do
    allow(report).to receive(:generate).and_return("%PDF-regimen")

    get "/reports/regimen_masters/5/pdf"

    expect(response).to have_http_status(:ok)
    expect(response.media_type).to eq("application/pdf")
    expect(response.headers["Content-Disposition"]).to start_with("inline")
    expect(response.body).to eq("%PDF-regimen")
  end

  it "maps the report errors to JSON responses" do
    {
      RegimenMasterReport::NotFound => [404, "regimen_not_found"],
      RegimenMasterReport::NotApproved => [422, "regimen_not_approved"],
      RegimenMasterReport::UpstreamError => [502, "upstream_unreachable"]
    }.each do |error, (status, code)|
      allow(report).to receive(:generate).and_raise(error)

      get "/reports/regimen_masters/5/pdf"

      expect(response).to have_http_status(status)
      expect(response.parsed_body["error"]).to eq(code)
    end
  end
end
