require "rails_helper"
require "support/dicom_fixture"

RSpec.describe "Imaging::Instances", type: :request do
  let(:sop_uid) { "1.2.392.200036.9116.2.5.1.1" }
  let(:meta) do
    {
      sop_instance_uid: sop_uid, study_instance_uid: "1.2.392.1", series_instance_uid: "1.2.392.1.1",
      modality: "CT", series_number: "2", instance_number: "15", number_of_frames: "",
      study_date: "20260901", study_description: "胸部CT", source_patient_name: "山田 太郎"
    }
  end

  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  def upload(patient_id: "pat-1", meta_override: {}, headers: {}, **file_options)
    post "/imaging/instances",
         params: {
           file: DicomFixture.upload(sop_instance_uid: sop_uid, **file_options),
           patient_id: patient_id,
           meta: meta.merge(meta_override).to_json
         },
         headers: headers
  end

  describe "POST /imaging/instances" do
    it "stores the file and the declared attributes" do
      upload(transfer_syntax_uid: "1.2.840.10008.1.2.4.70")

      expect(response).to have_http_status(:created)
      expect(response.parsed_body).to include("status" => "created", "sop_instance_uid" => sop_uid)

      instance = DicomInstance.find_by!(sop_instance_uid: sop_uid)
      expect(instance).to have_attributes(
        patient_id: "pat-1", study_instance_uid: "1.2.392.1", series_instance_uid: "1.2.392.1.1",
        sop_class_uid: DicomFixture::SOP_CLASS_CT, transfer_syntax_uid: "1.2.840.10008.1.2.4.70",
        modality: "CT", series_number: 2, instance_number: 15, number_of_frames: nil,
        source_patient_name: "山田 太郎"
      )
      expect(instance.file).to be_attached
      expect(instance.file.download).to eq(DicomFixture.bytes(sop_instance_uid: sop_uid, transfer_syntax_uid: "1.2.840.10008.1.2.4.70"))
      expect(instance.byte_size).to eq(instance.file.blob.byte_size)
    end

    it "is idempotent for the same patient" do
      upload
      expect { upload }.not_to change(DicomInstance, :count)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["status"]).to eq("exists")
      expect(ActiveStorage::Blob.count).to eq(1)
    end

    it "refuses a UID that already belongs to another patient" do
      upload
      upload(patient_id: "pat-2")

      expect(response).to have_http_status(:conflict)
    end

    it "rejects a file that is not DICOM" do
      upload(preamble: false)

      expect(response).to have_http_status(:unprocessable_content)
      expect(DicomInstance.count).to eq(0)
    end

    it "rejects a declared UID that differs from the file" do
      upload(meta_override: { sop_instance_uid: "1.2.999" })

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "rejects a malformed study UID" do
      upload(meta_override: { study_instance_uid: "../etc" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(ActiveStorage::Blob.count).to eq(0)
    end

    it "requires a login session and a CSRF token when ADMIN_TOKEN is set" do
      with_admin_token("s3cret") do
        upload
        expect(response).to have_http_status(:unauthorized)

        post "/auth/session", params: { login_id: "administrator", password: "s3cret" }, as: :json
        csrf_token = response.parsed_body["csrf_token"]

        upload
        expect(response).to have_http_status(:forbidden)

        upload(headers: { "X-CSRF-Token" => csrf_token })
        expect(response).to have_http_status(:created)
      end
    end
  end

  describe "GET /imaging/instances/:sop_uid" do
    before { upload }

    it "returns the stored bytes" do
      get "/imaging/instances/#{sop_uid}", params: { patient: "pat-1" }

      expect(response).to have_http_status(:ok)
      expect(response.media_type).to eq("application/dicom")
      expect(response.headers["Cache-Control"]).to include("immutable")
      expect(response.body.b).to eq(DicomFixture.bytes(sop_instance_uid: sop_uid))
    end

    it "answers 304 to a matching If-None-Match" do
      get "/imaging/instances/#{sop_uid}", params: { patient: "pat-1" }
      etag = response.headers["ETag"]

      get "/imaging/instances/#{sop_uid}", params: { patient: "pat-1" }, headers: { "If-None-Match" => etag }

      expect(response).to have_http_status(:not_modified)
    end

    it "hides an instance of another patient" do
      get "/imaging/instances/#{sop_uid}", params: { patient: "pat-2" }

      expect(response).to have_http_status(:not_found)
    end

    it "answers 404 without a patient" do
      get "/imaging/instances/#{sop_uid}"

      expect(response).to have_http_status(:not_found)
    end
  end
end
