require "rails_helper"

# 自己血の採血ラベル: 採血記録 1 件と採った血・患者・元のオーダーを 1 回の検索で引き、
# 製剤番号・型・有効期限を刷る。採血記録でなければ NotFound。
RSpec.describe AutologousLabelReport do
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
  let(:hub) do
    { "resourceType" => "Procedure", "id" => "c1", "status" => "completed",
      "category" => { "coding" => [{ "system" => described_class::CATEGORY_SYSTEM, "code" => "autologous-collection" }] },
      "subject" => { "reference" => "Patient/p1" }, "basedOn" => [{ "reference" => "ServiceRequest/o1" }],
      "performedDateTime" => "2026-11-01T10:00:00+09:00" }
  end
  let(:unit) do
    { "resourceType" => "MedicationDispense", "id" => "u1", "status" => "preparation",
      "identifier" => [{ "system" => described_class::PRODUCT_NUMBER_SYSTEM, "value" => "A-2-20261101-1" }],
      "medicationCodeableConcept" => { "coding" => [{ "display" => "自己血(貯血式)" }] },
      "quantity" => { "value" => 400, "unit" => "mL" },
      "extension" => [
        { "url" => described_class::ABO_EXT_URL, "valueCodeableConcept" => { "coding" => [{ "code" => "A" }] } },
        { "url" => described_class::RHD_EXT_URL, "valueCodeableConcept" => { "coding" => [{ "code" => "positive" }] } },
        { "url" => described_class::EXPIRY_EXT_URL, "valueDate" => "2026-12-06" }
      ],
      "partOf" => [{ "reference" => "Procedure/c1" }] }
  end
  let(:order) { { "resourceType" => "ServiceRequest", "id" => "o1", "occurrenceDateTime" => "2026-11-10T10:00:00+09:00" } }

  def stub_search(resources)
    stub_request(:get, %r{#{base_url}/Procedure\?}).to_return(
      status: 200, headers: { "Content-Type" => "application/fhir+json" },
      body: { "resourceType" => "Bundle", "type" => "searchset", "entry" => resources.map { |r| { "resource" => r } } }.to_json
    )
  end

  it "renders a label for the collected unit" do
    stub_search([hub, patient, order, unit])
    pdf = described_class.new("c1", gateway:).generate
    expect(pdf[0, 4]).to eq("%PDF")
  end

  it "raises NotFound when the procedure is not a collection" do
    stub_search([hub.merge("category" => { "coding" => [{ "system" => described_class::CATEGORY_SYSTEM, "code" => "x" }] }), patient, unit])
    expect { described_class.new("c1", gateway:).generate }.to raise_error(described_class::NotFound)
  end
end
