require "rails_helper"
require "support/billing_fhir_fixtures"

RSpec.describe "Master::DpcCodings / DpcClassifications", type: :request do
  before(:context) do
    MasterImport::DpcTableImporter.call(File.open(Rails.root.join("spec/fixtures/files/dpc_tables_sample.xlsx")))
  end

  after(:context) do
    ActiveRecord::Base.connection.tables.grep(/\Amaster_dpc_/).each do |table|
      ActiveRecord::Base.connection.execute("DELETE FROM #{table}")
    end
  end

  let(:store) { BillingFhirFixtures::FakeStore.new }

  before do
    store.add({ "resourceType" => "Encounter", "id" => "enc-1", "status" => "in-progress",
                "subject" => { "reference" => "Patient/pat-1" }, "period" => { "start" => "2026-09-01T10:00:00+09:00" } },
              { "resourceType" => "Patient", "id" => "pat-1", "birthDate" => "1950-01-01" })
    allow(Integrations::FhirStore).to receive(:new).and_return(store)
  end

  describe "POST /master/dpc/coding" do
    it "様式1 の値と上書きを受けて判定結果を返す" do
      post "/master/dpc/coding", params: { encounter_id: "enc-1", inputs: { icd10: "C182" },
                                           overrides: { branches: { surgery: "97" } } }, as: :json

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["dpc_codes"]).to eq(["060035xx97x0xx"])
      expect(body["branches"].find { |b| b["key"] == "surgery" }).to include("status" => "override")
      expect(body["stay"]).to include("admitted_on" => "2026-09-01", "discharged_on" => nil)
    end

    it "入院が無ければ 404、入院の指定が無ければ 422" do
      post "/master/dpc/coding", params: { encounter_id: "nope", inputs: {} }, as: :json
      expect(response).to have_http_status(:not_found)

      post "/master/dpc/coding", params: { inputs: {} }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "上流に届かなければ 502" do
      allow(store).to receive(:read_or_nil).and_raise(Integrations::FhirStore::UpstreamError, "down")

      post "/master/dpc/coding", params: { encounter_id: "enc-1", inputs: { icd10: "C182" } }, as: :json

      expect(response).to have_http_status(:bad_gateway)
    end
  end

  describe "GET /master/dpc/classifications" do
    it "名称・コードで分類を探し、選んだ分類の 14 桁と点数を返す" do
      get "/master/dpc/classifications", params: { q: "結腸", mdc6: "060035", on: "2026-09-10" }

      body = JSON.parse(response.body)
      expect(body["edition"]).to eq("20260601")
      expect(body["classifications"]).to eq([{ "code" => "060035", "name" => "結腸（虫垂を含む。）の悪性腫瘍" }])
      row = body["points"].find { |p| p["dpc_code"] == "060035xx99x4xx" }
      expect(row).to include("bundled" => true, "days" => [2, 3, 30], "points" => [3713, 2694, 2140])
    end
  end
end
