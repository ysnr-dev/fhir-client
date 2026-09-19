require "rails_helper"

RSpec.describe ImagingStudyBuilder do
  def instance(attrs = {})
    DicomInstance.new({
      patient_id: "pat-1", study_instance_uid: "1.2.3", series_instance_uid: "1.2.3.1",
      sop_instance_uid: "1.2.3.1.1", sop_class_uid: "1.2.840.10008.5.1.4.1.1.2",
      modality: "CT", series_number: 1, instance_number: 1,
      study_date: "20260901", study_time: "093015.250", study_description: "胸部CT",
      accession_number: "ACC-1", institution_name: "他院", source_patient_id: "X-9", source_patient_name: "山田 太郎"
    }.merge(attrs))
  end

  it "builds the study from the stored rows" do
    rows = [
      instance,
      instance(sop_instance_uid: "1.2.3.1.2", instance_number: 2),
      instance(series_instance_uid: "1.2.3.2", sop_instance_uid: "1.2.3.2.1", series_number: 2,
               modality: "SR", series_description: "Dose Report", body_part: "CHEST")
    ]

    study = described_class.new(rows).build

    expect(study["identifier"]).to eq([
      { "system" => "urn:dicom:uid", "value" => "urn:oid:1.2.3" },
      { "type" => { "coding" => [{ "system" => "http://terminology.hl7.org/CodeSystem/v2-0203", "code" => "ACSN" }] },
        "value" => "ACC-1" }
    ])
    expect(study).to include("status" => "available", "started" => "2026-09-01T09:30:15+09:00",
                             "description" => "胸部CT", "numberOfSeries" => 2, "numberOfInstances" => 3)
    expect(study["subject"]).to eq("reference" => "Patient/pat-1")
    expect(study["modality"].map { |c| c["code"] }).to eq(%w[CT SR])
    expect(study["series"].map { |s| s["uid"] }).to eq(%w[1.2.3.1 1.2.3.2])
    expect(study["series"][0]["instance"].map { |i| i["number"] }).to eq([1, 2])
    expect(study["series"][0]["instance"][0]["sopClass"])
      .to eq("system" => "urn:ietf:rfc:3986", "code" => "urn:oid:1.2.840.10008.5.1.4.1.1.2")
    expect(study["series"][1]).to include("description" => "Dose Report", "bodySite" => { "display" => "CHEST" })

    source = study["extension"].first
    expect(source["url"]).to eq(described_class::SOURCE_EXTENSION_URL)
    expect(source["extension"]).to include({ "url" => "patientName", "valueString" => "山田 太郎" })
  end

  it "falls back to a date-only started and an OT series when the tags are missing" do
    study = described_class.new([instance(study_time: nil, modality: nil, accession_number: nil)]).build

    expect(study["started"]).to eq("2026-09-01")
    expect(study).not_to have_key("modality")
    expect(study["series"][0]["modality"]["code"]).to eq("OT")
    expect(study["identifier"].size).to eq(1)
  end

  it "omits started and the source extension when nothing is known" do
    study = described_class.new([instance(study_date: nil, institution_name: nil,
                                          source_patient_id: nil, source_patient_name: nil)]).build

    expect(study).not_to have_key("started")
    expect(study).not_to have_key("extension")
  end
end
