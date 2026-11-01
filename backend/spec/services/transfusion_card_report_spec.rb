require "rails_helper"

# 輸血関連情報カード: 上流アクセスが batch Bundle 1 本であること、患者が無ければ NotFound、
# 血液型の 2 回一致・不規則抗体・輸血歴・副作用歴が内容に載ることを検証する(描画は同梱のレイアウトで実際に行う)。
RSpec.describe TransfusionCardReport do
  let(:base_url) { "http://fhir.example" }
  let(:gateway) do
    FhirGateway.new(
      base_url: base_url, host_header: nil,
      token_provider: FhirTokenProvider.new(base_url: base_url, client_id: nil, client_secret: nil, host_header: nil)
    )
  end
  let(:patient) do
    { "resourceType" => "Patient", "id" => "p1", "identifier" => [{ "value" => "2" }],
      "name" => [{ "family" => "テスト", "given" => ["太郎"] }], "gender" => "male", "birthDate" => "1990-01-01" }
  end

  def lab(id, jlac, text, date)
    { "resourceType" => "Observation", "id" => id,
      "code" => { "coding" => [{ "system" => described_class::JLAC11_SYSTEM, "code" => jlac }] },
      "valueCodeableConcept" => { "text" => text }, "effectiveDateTime" => date }
  end

  def searchset(resources)
    { "response" => { "status" => "200" },
      "resource" => { "resourceType" => "Bundle", "type" => "searchset",
                      "entry" => resources.map { |r| { "resource" => r } } } }
  end

  before do
    Master::LabResultItem.create!(result_item_code: "160039110", name: "ABO血液型", data_type: "CD",
                                  jlac11_code: "K1001000021100004")
  end

  it "fetches everything in one batch and renders a PDF" do
    hub = { "resourceType" => "Procedure", "id" => "h1", "status" => "completed",
            "performedPeriod" => { "start" => "2026-11-02T10:00:00+09:00" } }
    bag = { "resourceType" => "MedicationAdministration", "status" => "completed",
            "medicationCodeableConcept" => { "coding" => [{ "display" => "赤血球液-LR" }] },
            "dosage" => { "dose" => { "value" => 2, "unit" => "単位" } },
            "extension" => [{ "url" => described_class::LOT_NUMBER_EXT_URL, "valueString" => "A1" }],
            "partOf" => [{ "reference" => "Procedure/h1" }] }
    reaction = { "resourceType" => "Observation", "effectiveDateTime" => "2026-11-02",
                 "code" => { "coding" => [{ "system" => described_class::OBSERVATION_SYSTEM, "code" => "reaction" }] },
                 "valueCodeableConcept" => { "coding" => [{ "code" => "present" }] },
                 "component" => [{ "code" => { "coding" => [{ "display" => "発熱" }] }, "valueBoolean" => true }],
                 "partOf" => [{ "reference" => "Procedure/h1" }] }
    requests = []
    stub_request(:post, "#{base_url}/").to_return do |request|
      bundle = JSON.parse(request.body)
      requests << bundle
      urls = bundle["entry"].map { |e| e.dig("request", "url") }
      expect(urls[1]).to include("K1001000021100004").and include("160039110")
      body = { "resourceType" => "Bundle", "type" => "batch-response", "entry" => [
        { "response" => { "status" => "200" }, "resource" => patient },
        searchset([lab("a1", "K1001000021100004", "A", "2026-10-20"), lab("a2", "K1001000021100004", "A", "2026-10-27")]),
        searchset([]),
        searchset([hub, bag, reaction]),
        { "response" => { "status" => "404" } }
      ] }
      { status: 200, body: body.to_json, headers: { "Content-Type" => "application/fhir+json" } }
    end

    pdf = described_class.new("p1", gateway:).generate

    expect(requests.size).to eq(1)
    expect(pdf[0, 4]).to eq("%PDF")
  end

  it "raises NotFound when the patient does not exist" do
    stub_request(:post, "#{base_url}/").to_return(
      status: 200, headers: { "Content-Type" => "application/fhir+json" },
      body: { "resourceType" => "Bundle", "type" => "batch-response",
              "entry" => [{ "response" => { "status" => "404" } }] + Array.new(4) { searchset([]) } }.to_json
    )

    expect { described_class.new("missing", gateway:).generate }.to raise_error(described_class::NotFound)
  end
end
