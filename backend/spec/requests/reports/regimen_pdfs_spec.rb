require "rails_helper"

# ルーティングと、帳票の例外 → HTTP 応答の対応を見る(中身の組み立ては RegimenReport の spec)。
RSpec.describe "Reports::RegimenPdfs", type: :request do
  let(:report) { instance_double(RegimenReport) }

  before { allow(RegimenReport).to receive(:new).with("h1").and_return(report) }

  it "returns the plan of the requested cycle inline" do
    allow(report).to receive(:generate_plan).with(cycle: "2").and_return("%PDF-plan")

    get "/reports/regimens/h1/plan/pdf", params: { cycle: "2" }

    expect(response).to have_http_status(:ok)
    expect(response.media_type).to eq("application/pdf")
    expect(response.headers["Content-Disposition"]).to start_with("inline")
    expect(response.body).to eq("%PDF-plan")
  end

  it "returns the schedule" do
    allow(report).to receive(:generate_schedule).and_return("%PDF-schedule")

    get "/reports/regimens/h1/schedule/pdf"

    expect(response).to have_http_status(:ok)
    expect(response.body).to eq("%PDF-schedule")
  end

  it "maps the report errors to JSON responses" do
    {
      RegimenReport::NotFound => [404, "order_not_found"],
      RegimenReport::NotRegimenOrder => [422, "not_regimen_order"],
      RegimenReport::NoDayOrders => [422, "no_regimen_day_orders"],
      RegimenReport::CycleNotFound => [404, "cycle_not_found"],
      RegimenReport::TooManyOrders => [422, "too_many_day_orders"],
      RegimenReport::UpstreamError => [502, "upstream_unreachable"]
    }.each do |error, (status, code)|
      allow(report).to receive(:generate_plan).and_raise(error)

      get "/reports/regimens/h1/plan/pdf"

      expect(response).to have_http_status(status)
      expect(response.parsed_body["error"]).to eq(code)
    end
  end
end
