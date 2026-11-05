require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::RasO17 do
  F = Ssmix2::Fhir unless defined?(F)
  let(:header) do
    { "resourceType" => "ServiceRequest", "id" => "sr1", "status" => "active", "subject" => { "reference" => "Patient/p1" },
      "category" => [{ "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "prescription" }] },
                     { "coding" => [{ "system" => F::PRESCRIPTION_SETTING_SYSTEM, "code" => "inpatient" }] }],
      "authoredOn" => "2026-11-04T10:30:45+09:00", "occurrenceDateTime" => "2026-11-04",
      "requester" => { "reference" => "Practitioner/doc1" },
      "extension" => [{ "url" => F::ORDER_DEPARTMENT_EXT_URL, "valueReference" => { "reference" => "Organization/dept1" } }] }
  end
  let(:tablet) do
    { "resourceType" => "MedicationRequest", "id" => "mr1", "status" => "active", "basedOn" => [{ "reference" => "ServiceRequest/sr1" }],
      "identifier" => [{ "system" => F::RP_NUMBER_SYSTEM, "value" => "1" }, { "system" => F::ORDER_IN_RP_SYSTEM, "value" => "1" }],
      "medicationCodeableConcept" => { "coding" => [{ "system" => F::MEDICINE_CODE_SYSTEM, "code" => "610406001", "display" => "ダーゼン錠" }], "text" => "ダーゼン錠" },
      "dosageInstruction" => [{ "timing" => { "code" => { "coding" => [{ "system" => F::USAGE_CODE_SYSTEM, "code" => "1013044400000000", "display" => "１日３回朝昼夕食後" }] } },
                                "doseAndRate" => [{ "doseQuantity" => { "value" => 1, "unit" => "錠" }, "rateRatio" => { "numerator" => { "value" => 3, "unit" => "錠" }, "denominator" => { "value" => 1, "unit" => "d" } } }] }],
      "dispenseRequest" => { "expectedSupplyDuration" => { "value" => 5, "unit" => "日", "code" => "d" } } }
  end
  let(:hub) do
    { "resourceType" => "Procedure", "status" => "completed", "subject" => { "reference" => "Patient/p1" },
      "category" => { "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "prescription" }] }, "code" => { "text" => "与薬" },
      "basedOn" => [{ "reference" => "ServiceRequest/sr1" }], "performedDateTime" => "2026-11-05T08:05:00+09:00",
      "performer" => [{ "actor" => { "reference" => "Practitioner/nurse1" } }] }
  end
  let(:administration) do
    { "resourceType" => "MedicationAdministration", "status" => "completed", "subject" => { "reference" => "Patient/p1" },
      "medicationCodeableConcept" => tablet["medicationCodeableConcept"], "effectiveDateTime" => "2026-11-05T08:05:00+09:00",
      "partOf" => [{ "reference" => "urn:uuid:hub" }], "request" => { "reference" => "MedicationRequest/mr1" },
      "dosage" => { "dose" => { "value" => 1, "unit" => "錠" } },
      "extension" => [{ "url" => F::MEDICATION_LOT_NUMBER_EXT_URL, "valueString" => "LOT-7" }],
      "performer" => [{ "actor" => { "reference" => "Practitioner/nurse1" } }] }
  end
  let(:nurse) { ssmix2_doctor(id: "nurse1").merge("name" => [{ "extension" => [{ "url" => F::REPRESENTATION_URL, "valueCode" => "IDE" }], "family" => "看護", "given" => ["花子"] }], "qualification" => []) }
  let(:resources) do
    { "Patient/p1" => ssmix2_patient, "Practitioner/doc1" => ssmix2_doctor, "Practitioner/nurse1" => nurse, "Organization/dept1" => ssmix2_department,
      "ServiceRequest/sr1" => header, "Location/bed1" => ssmix2_location("bed1", "1", "bd", part_of: "room1"),
      "Location/room1" => ssmix2_location("room1", "302", "ro", part_of: "ward1"), "Location/ward1" => ssmix2_location("ward1", "32", "wa") }
  end
  let(:searches) do
    { ["MedicationRequest", { "based-on" => "ServiceRequest/sr1" }] => [tablet],
      ["Encounter", { "patient" => "Patient/p1", "status" => "in-progress" }] => [ssmix2_admission] }
  end
  let(:store) { ssmix2_store(resources, searches: searches) }
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }

  before do
    ssmix2_enable!
    Master::HotCode.create!(hot_code: "108665201", receipt_code_1: "610406001")
  end

  def perform_transaction(hub_resource, administrations)
    entries = [{ "fullUrl" => "urn:uuid:hub", "resource" => hub_resource, "request" => { "method" => "POST", "url" => "Procedure" } }] +
              administrations.each_with_index.map { |ma, i| { "fullUrl" => "urn:uuid:ma#{i}", "resource" => ma, "request" => { "method" => "POST", "url" => "MedicationAdministration" } } }
    responses = [{ "response" => { "status" => "201", "location" => "Procedure/proc1/_history/1" } }] +
                administrations.each_with_index.map { |_, i| { "response" => { "status" => "201", "location" => "MedicationAdministration/ma#{i}/_history/1" } } }
    ssmix2_transaction(method: "POST", path: "/", request: { "resourceType" => "Bundle", "type" => "transaction", "entry" => entries },
                       response: { "resourceType" => "Bundle", "type" => "transaction-response", "entry" => responses })
  end

  def build(transaction)
    written = Ssmix2::Dispatcher.written_resources(transaction).find { |w| w.type == "Procedure" }
    described_class.new(context: context, transaction: transaction, written: written).build
  end

  it "builds RAS^O17 (OMP-11) for an oral administration with the order segments and an RXA per medicine" do
    result = build(perform_transaction(hub, [administration]))

    expect(result.data_kind).to eq("OMP-11")
    expect(result.service_date).to eq("20261105")
    expect(result.process).to eq("INS")
    expect(result.department_code).to eq("01")
    expect(segment(result, "MSH")).to include("|RAS^O17^RAS_O17|")
    expect(segment(result, "PV1").split("|")[2..3]).to eq(%w[I 32^302^1^^^N])
    orc = segment(result, "ORC").split("|")
    expect(orc[1]).to eq("NW")
    expect(orc[2]).to match(/\A\d{15}\z/)
    expect(orc[3]).to eq(result.order_no)
    expect(orc[3]).not_to eq(orc[2])
    expect(orc[9]).to eq("20261104103012")
    expect(segments_of(result).map { |s| s.split("|").first }).to eq(%w[MSH PID PV1 ORC RXE TQ1 RXR RXA RXR])
    rxa = segment(result, "RXA").split("|")
    expect(rxa[1..4]).to eq(%w[0 1 20261105080500 20261105080500])
    expect(rxa[5]).to eq("108665201^ダーゼン錠^HOT9^610406001^ダーゼン錠^99ZRC")
    expect(rxa[6..7]).to eq(%w[1 TAB^錠^MR9P])
    expect(rxa[10]).to eq("nurse1^看護^花子^^^^^^^L^^^^^I")
    expect(rxa[11]).to eq("32^302^1^^^N")
    expect(rxa[15]).to eq("LOT-7")
    expect(rxa[20]).to eq("CP")
    expect(rxa[22]).to eq("20261104103012")
  end

  it "marks a not-done administration NA with the reason and sends DEL with CA when the record is deleted" do
    skipped = hub.merge("status" => "not-done", "statusReason" => { "text" => "絶食のため" })
    result = build(perform_transaction(skipped, []))
    rxa = segment(result, "RXA").split("|")
    expect(rxa[5]).to start_with("108665201^ダーゼン錠^HOT9")
    expect(rxa[6]).to eq("")
    expect(rxa[18]).to eq("^絶食のため^99ZRS")
    expect(rxa[20]).to eq("NA")

    deleting = ssmix2_transaction(method: "POST", path: "/", request: {
      "resourceType" => "Bundle", "type" => "transaction",
      "entry" => [{ "request" => { "method" => "DELETE", "url" => "MedicationAdministration/ma0" } }, { "request" => { "method" => "DELETE", "url" => "Procedure/proc1" } }]
    }, response: { "resourceType" => "Bundle", "type" => "transaction-response", "entry" => [{ "response" => { "status" => "204" } }, { "response" => { "status" => "204" } }] })
    allow(store).to receive(:search).with("Procedure/proc1/_history", anything, anything).and_return([hub.merge("id" => "proc1")])
    allow(store).to receive(:search).with("MedicationAdministration/ma0/_history", anything, anything)
                                    .and_return([administration.merge("id" => "ma0", "partOf" => [{ "reference" => "Procedure/proc1" }])])
    deleted = build(deleting)
    expect(deleted.process).to eq("DEL")
    expect(segment(deleted, "ORC").split("|")[1]).to eq("CA")
    expect(segment(deleted, "RXA").split("|")[5]).to start_with("108665201^")
  end

  it "builds OMP-12 for an injection with RXC components, the RP group number and a stopped infusion as PA" do
    injection_header = header.merge("category" => [{ "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "injection" }] },
                                                   { "coding" => [{ "system" => F::PRESCRIPTION_SETTING_SYSTEM, "code" => "inpatient" }] }])
    fluid = tablet.merge("id" => "mr2", "medicationCodeableConcept" => { "coding" => [{ "system" => F::MEDICINE_CODE_SYSTEM, "code" => "620007329", "display" => "ソリタ" }], "text" => "ソリタ" },
                         "dosageInstruction" => [{ "route" => { "coding" => [{ "code" => "IV", "display" => "静脈内" }] }, "timing" => { "event" => ["2026-11-05T08:00:00+09:00"] },
                                                   "doseAndRate" => [{ "doseQuantity" => { "value" => 500, "unit" => "mL" } }] }])
    resources["ServiceRequest/sr1"] = injection_header
    searches[["MedicationRequest", { "based-on" => "ServiceRequest/sr1" }]] = [fluid]
    injected = administration.merge("status" => "stopped", "medicationCodeableConcept" => fluid["medicationCodeableConcept"],
                                    "request" => { "reference" => "MedicationRequest/mr2" }, "dosage" => { "dose" => { "value" => 300, "unit" => "mL" } },
                                    "effectivePeriod" => { "start" => "2026-11-05T08:05:21+09:00", "end" => "2026-11-05T10:00:00+09:00" })
    injection_hub = hub.merge("category" => { "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "injection" }] }, "status" => "stopped",
                              "performedPeriod" => { "start" => "2026-11-05T08:05:21+09:00", "end" => "2026-11-05T10:00:00+09:00" })

    result = build(perform_transaction(injection_hub, [injected]))

    expect(result.data_kind).to eq("OMP-12")
    expect(segments_of(result).map { |s| s.split("|").first }).to eq(%w[MSH PID PV1 ORC RXE TQ1 RXR RXC RXA RXR])
    expect(segment(result, "ORC").split("|")[4]).to eq("#{segment(result, 'ORC').split('|')[2]}_01")
    expect(segment(result, "RXC").split("|")[2]).to eq("620007329^ソリタ^99ZRC")
    rxa = segment(result, "RXA").split("|")
    expect(rxa[3..4]).to eq(%w[20261105080521 20261105100000])
    expect(rxa[6..7]).to eq(%w[300 ML^mL^MR9P])
    expect(rxa[20]).to eq("PA")
    expect(result.warnings).to include("HOT コードが引けない薬剤があります: ソリタ")
  end
end
