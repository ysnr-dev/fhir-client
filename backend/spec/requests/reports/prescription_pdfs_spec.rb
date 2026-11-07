require "rails_helper"

RSpec.describe "Reports::PrescriptionPdfs", type: :request do
  describe "POST /reports/prescriptions/pdf" do
    let(:report) { instance_double(PrescriptionReport, generate: "%PDF-1.7") }

    it "returns one PDF for the given orders" do
      expect(PrescriptionReport).to receive(:new).with(%w[o2 o1]).and_return(report)

      post "/reports/prescriptions/pdf", params: { order_ids: %w[o2 o1] }, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.media_type).to eq("application/pdf")
      expect(response.headers["Content-Disposition"]).to start_with("inline")
      expect(response.body).to eq("%PDF-1.7")
    end

    it "rejects an empty order list" do
      expect(PrescriptionReport).not_to receive(:new)

      post "/reports/prescriptions/pdf", params: { order_ids: [] }, as: :json

      expect(response).to have_http_status(:bad_request)
    end

    it "returns 422 when an order has nothing to print" do
      allow(report).to receive(:generate).and_raise(PrescriptionReport::NoMedication)
      allow(PrescriptionReport).to receive(:new).and_return(report)

      post "/reports/prescriptions/pdf", params: { order_ids: %w[o1] }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("no_prescription_content")
    end
  end
end
