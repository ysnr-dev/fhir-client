require "rails_helper"

RSpec.describe "LabLabels", type: :request do
  def issue!(order: "order-1", specimen: "212", container: "T03")
    LabLabelRecord.ensure_for(
      order_fhir_id: order, specimen_code: specimen, container_code: container
    )
  end

  describe "POST /lab_labels/arrivals" do
    it "records the arrival and returns the record" do
      record = issue!

      post "/lab_labels/arrivals", params: { label_number: record.label_number }, as: :json

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["order_fhir_id"]).to eq("order-1")
      expect(body["specimen_code"]).to eq("212")
      expect(body["arrived_at"]).to be_present
      expect(body["already_arrived"]).to be(false)
      expect(record.reload.arrived_at).to be_present
    end

    it "is idempotent: a second scan keeps the original time and flags already_arrived" do
      record = issue!
      post "/lab_labels/arrivals", params: { label_number: record.label_number }, as: :json
      first_time = record.reload.arrived_at

      post "/lab_labels/arrivals", params: { label_number: record.label_number }, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["already_arrived"]).to be(true)
      expect(record.reload.arrived_at).to eq(first_time)
    end

    it "rejects a number with a wrong check digit" do
      record = issue!
      broken = record.label_number.sub(/\d\z/) { |d| ((d.to_i + 1) % 10).to_s }

      post "/lab_labels/arrivals", params: { label_number: broken }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("invalid_number")
    end

    it "returns 404 for a well-formed number that was never issued" do
      base = "9999999999"
      number = "#{base}#{LabLabelRecord.check_digit(base)}"

      post "/lab_labels/arrivals", params: { label_number: number }, as: :json

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body["error"]).to eq("unknown_number")
    end
  end

  describe "DELETE /lab_labels/arrivals/:label_number" do
    it "clears the arrival" do
      record = issue!
      record.update!(arrived_at: Time.current, arrived_by: "tech01")

      delete "/lab_labels/arrivals/#{record.label_number}"

      expect(response).to have_http_status(:ok)
      expect(record.reload.arrived_at).to be_nil
      expect(record.arrived_by).to be_nil
    end

    it "returns 404 for an unknown number" do
      delete "/lab_labels/arrivals/00000000000"

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "GET /lab_labels" do
    it "returns records for the given orders only" do
      a = issue!(order: "order-a", specimen: "212")
      b = issue!(order: "order-a", specimen: "250", container: "T01")
      issue!(order: "order-b", specimen: "212")
      b.update!(arrived_at: Time.current)

      get "/lab_labels", params: { order_ids: "order-a,order-x" }

      expect(response).to have_http_status(:ok)
      items = response.parsed_body["items"]
      expect(items.map { |i| i["label_number"] }).to eq([a.label_number, b.label_number])
      expect(items[0]["arrived_at"]).to be_nil
      expect(items[1]["arrived_at"]).to be_present
      expect(items[0]["issued_at"]).to be_present
    end

    it "returns nothing when order_ids is missing" do
      issue!

      get "/lab_labels"

      expect(response.parsed_body["items"]).to eq([])
    end
  end
end
