require "rails_helper"

RSpec.describe "Reports::LabLabelPdfs", type: :request do
  describe "POST /reports/lab_labels/pdf" do
    let(:report) { instance_double(LabLabelReport, generate: "%PDF-1.7") }

    it "returns one PDF for the given orders and scope" do
      expect(LabLabelReport).to receive(:new).with(%w[o2 o1], scope: "unissued").and_return(report)

      post "/reports/lab_labels/pdf", params: { order_ids: %w[o2 o1], scope: "unissued" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.media_type).to eq("application/pdf")
      expect(response.headers["Content-Disposition"]).to start_with("inline")
      expect(response.body).to eq("%PDF-1.7")
    end

    it "rejects an unknown scope" do
      expect(LabLabelReport).not_to receive(:new)

      post "/reports/lab_labels/pdf", params: { order_ids: %w[o1], scope: "all" }, as: :json

      expect(response).to have_http_status(:bad_request)
    end

    it "rejects an empty order list" do
      expect(LabLabelReport).not_to receive(:new)

      post "/reports/lab_labels/pdf", params: { order_ids: [], scope: "issued" }, as: :json

      expect(response).to have_http_status(:bad_request)
    end

    it "returns 422 when no tube falls in the scope" do
      allow(report).to receive(:generate).and_raise(LabLabelReport::NoLabelTarget)
      allow(LabLabelReport).to receive(:new).and_return(report)

      post "/reports/lab_labels/pdf", params: { order_ids: %w[o1], scope: "issued" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("no_label_target")
    end
  end
end
