require "rails_helper"
require "support/dicom_fixture"

RSpec.describe "Imaging::Studies", type: :request do
  let(:upstream_base) { ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000") }
  let(:study_uid) { "1.2.392.1" }
  let(:conditional_url) { "#{upstream_base}/ImagingStudy" }
  let(:identifier) { "urn:dicom:uid|urn:oid:#{study_uid}" }

  def store(sop_uid, patient_id: "pat-1", study: study_uid, series: "#{study_uid}.1", number: 1)
    post "/imaging/instances", params: {
      file: DicomFixture.upload(sop_instance_uid: sop_uid),
      patient_id: patient_id,
      meta: { sop_instance_uid: sop_uid, study_instance_uid: study, series_instance_uid: series,
              modality: "CT", series_number: 1, instance_number: number, study_date: "20260901" }.to_json
    }
    expect(response).to have_http_status(:created)
  end

  before { FhirGateway.reset_connections! }

  it "lists the stored instance counts per study" do
    store("1.2.392.1.1.1")
    store("1.2.392.1.1.2", number: 2)
    store("1.2.392.2.1.1", study: "1.2.392.2", series: "1.2.392.2.1")
    store("1.2.392.9.1.1", patient_id: "pat-2", study: "1.2.392.9", series: "1.2.392.9.1")

    get "/imaging/studies", params: { patient: "pat-1" }

    expect(response.parsed_body).to contain_exactly(
      { "study_instance_uid" => "1.2.392.1", "instance_count" => 2 },
      { "study_instance_uid" => "1.2.392.2", "instance_count" => 1 }
    )
  end

  it "lists the instances of a study in display order" do
    store("1.2.392.1.1.2", number: 2)
    store("1.2.392.1.1.1", number: 1)

    get "/imaging/studies/#{study_uid}/instances", params: { patient: "pat-1" }

    expect(response.parsed_body.map { |i| i["sop_instance_uid"] }).to eq(%w[1.2.392.1.1.1 1.2.392.1.1.2])
    expect(response.parsed_body.first).to include("series_instance_uid" => "1.2.392.1.1",
                                                  "sop_class_uid" => DicomFixture::SOP_CLASS_CT)
  end

  describe "POST /imaging/studies/:study_uid/commit" do
    it "puts the ImagingStudy built from the stored rows" do
      store("1.2.392.1.1.1")
      store("1.2.392.1.1.2", number: 2)
      put_stub = stub_request(:put, conditional_url)
                 .with(query: { "identifier" => identifier }) { |request|
                   body = JSON.parse(request.body)
                   body["resourceType"] == "ImagingStudy" && body["numberOfInstances"] == 2 &&
                     body["subject"]["reference"] == "Patient/pat-1"
                 }
                 .to_return(status: 201, body: { resourceType: "ImagingStudy", id: "img-1" }.to_json,
                            headers: { "Content-Type" => "application/fhir+json" })

      post "/imaging/studies/#{study_uid}/commit", params: { patient_id: "pat-1" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("id" => "img-1", "instance_count" => 2)
      expect(put_stub).to have_been_requested.once
    end

    it "answers 404 when nothing is stored for the patient" do
      store("1.2.392.1.1.1")

      post "/imaging/studies/#{study_uid}/commit", params: { patient_id: "pat-2" }, as: :json

      expect(response).to have_http_status(:not_found)
    end

    it "answers 502 when the upstream rejects the study" do
      store("1.2.392.1.1.1")
      stub_request(:put, conditional_url).with(query: { "identifier" => identifier }).to_return(status: 422, body: "{}")

      post "/imaging/studies/#{study_uid}/commit", params: { patient_id: "pat-1" }, as: :json

      expect(response).to have_http_status(:bad_gateway)
    end
  end

  describe "DELETE /imaging/studies/:study_uid" do
    let(:delete_query) { { "identifier" => identifier, "patient" => "pat-1" } }

    before do
      store("1.2.392.1.1.1")
      store("1.2.392.1.1.2", number: 2)
    end

    it "deletes the upstream study, the rows and the blobs" do
      delete_stub = stub_request(:delete, conditional_url).with(query: delete_query).to_return(status: 204)

      delete "/imaging/studies/#{study_uid}", params: { patient: "pat-1" }

      expect(response).to have_http_status(:no_content)
      expect(delete_stub).to have_been_requested.once
      expect(DicomInstance.count).to eq(0)
      expect(ActiveStorage::Blob.count).to eq(0)
    end

    it "treats a missing upstream study as deleted" do
      stub_request(:delete, conditional_url).with(query: delete_query).to_return(status: 404, body: "{}")

      delete "/imaging/studies/#{study_uid}", params: { patient: "pat-1" }

      expect(response).to have_http_status(:no_content)
      expect(DicomInstance.count).to eq(0)
    end

    it "keeps the files when the upstream delete fails" do
      stub_request(:delete, conditional_url).with(query: delete_query).to_return(status: 500, body: "{}")

      delete "/imaging/studies/#{study_uid}", params: { patient: "pat-1" }

      expect(response).to have_http_status(:bad_gateway)
      expect(DicomInstance.count).to eq(2)
      expect(ActiveStorage::Blob.count).to eq(2)
    end
  end
end
