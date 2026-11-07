require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::RdeO11 do
  F = Ssmix2::Fhir unless defined?(F)
  let(:header) do
    { "resourceType" => "ServiceRequest", "id" => "sr1", "status" => "active", "subject" => { "reference" => "Patient/p1" },
      "category" => [{ "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "prescription" }] },
                     { "coding" => [{ "system" => F::PRESCRIPTION_SETTING_SYSTEM, "code" => "outpatient" }] },
                     { "coding" => [{ "system" => F::PRESCRIPTION_CATEGORY_SYSTEM, "code" => "external" }] }],
      "authoredOn" => "2026-11-04T10:30:45+09:00", "occurrenceDateTime" => "2026-11-04",
      "requester" => { "reference" => "Practitioner/doc1" },
      "extension" => [{ "url" => F::ORDER_DEPARTMENT_EXT_URL, "valueReference" => { "reference" => "Organization/dept1" } }] }
  end
  let(:tablet) do
    { "resourceType" => "MedicationRequest", "id" => "mr1", "status" => "active", "basedOn" => [{ "reference" => "ServiceRequest/sr1" }],
      "identifier" => [{ "system" => F::RP_NUMBER_SYSTEM, "value" => "1" }, { "system" => F::ORDER_IN_RP_SYSTEM, "value" => "1" }],
      "medicationCodeableConcept" => { "coding" => [{ "system" => F::MEDICINE_CODE_SYSTEM, "code" => "610406001", "display" => "ダーゼン錠（５mg)" },
                                                    { "system" => F::YJ_CODE_SYSTEM, "code" => "3959001F1030" }], "text" => "ダーゼン錠（５mg)" },
      "dosageInstruction" => [{ "timing" => { "code" => { "coding" => [{ "system" => F::USAGE_CODE_SYSTEM, "code" => "1013044400000000", "display" => "内服・経口・１日３回朝昼夕食後" }] } },
                                "doseAndRate" => [{ "doseQuantity" => { "value" => 1, "unit" => "錠" },
                                                    "rateRatio" => { "numerator" => { "value" => 3, "unit" => "錠" }, "denominator" => { "value" => 1, "unit" => "d" } } }] }],
      "dispenseRequest" => { "expectedSupplyDuration" => { "value" => 5, "unit" => "日", "code" => "d" } } }
  end
  let(:store) { ssmix2_store({ "Patient/p1" => ssmix2_patient, "Practitioner/doc1" => ssmix2_doctor, "Organization/dept1" => ssmix2_department }) }
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }

  before do
    ssmix2_enable!
    Master::HotCode.create!(hot_code: "108665201", receipt_code_1: "610406001")
  end

  def bundle_transaction(entries, responses, method: "POST")
    request = { "resourceType" => "Bundle", "type" => "transaction",
                "entry" => entries.map { |r| { "fullUrl" => "urn:uuid:#{r['id']}", "resource" => r.except("id"), "request" => { "method" => method, "url" => r["resourceType"] } } } }
    response = { "resourceType" => "Bundle", "type" => "transaction-response",
                 "entry" => responses.map { |ref| { "response" => { "status" => "201", "location" => "#{ref}/_history/1" } } } }
    ssmix2_transaction(method: "POST", path: "/", request: request, response: response)
  end

  it "builds RDE^O11 for an outpatient prescription with HOT9, MR9P units, JAMI usage and the YJ supplement" do
    transaction = bundle_transaction([header, tablet], %w[ServiceRequest/sr1 MedicationRequest/mr1])
    written = Ssmix2::Dispatcher.written_resources(transaction).find { |w| w.type == "ServiceRequest" }

    result = described_class.new(context: context, transaction: transaction, written: written).build

    expect(result.data_kind).to eq("OMP-01")
    expect(result.service_date).to eq("20261104")
    expect(result.process).to eq("INS")
    expect(result.department_code).to eq("01")
    expect(segment(result, "MSH")).to include("|RDE^O11^RDE_O11|")
    expect(segment(result, "PV1")).to eq("PV1|0001|O|01^^^^^C")
    orc = segment(result, "ORC").split("|")
    expect(orc[1]).to eq("NW")
    expect(orc[2]).to eq(result.order_no)
    expect(orc[4]).to eq("1")
    expect(orc[9]).to eq("20261104103045")
    expect(orc[10]).to eq("220^医師^一郎^^^^^^^L^^^^^I")
    expect(orc[12]).to eq("220^医師^一郎^^^^^^^L^^^^^I")
    expect(orc[17]).to eq("01^内科^HL70069")
    expect(orc[29]).to eq("O^外来患者オーダ^HL70482")
    rxe = segment(result, "RXE").split("|")
    expect(rxe[2]).to eq("108665201^ダーゼン錠（５mg)^HOT9^610406001^ダーゼン錠（５mg)^99ZRC")
    expect(rxe[3]).to eq("1")
    expect(rxe[5]).to eq("TAB^錠^MR9P")
    expect(rxe[10]).to eq("15")
    expect(rxe[11]).to eq("TAB^錠^MR9P")
    expect(rxe[15]).to eq("sr1")
    expect(rxe[21]).to eq("OHP^外来処方^MR9P~OHO^院外処方^MR9P")
    expect(rxe[31]).to eq("610406001^^99ZRC^3959001F1030^^YJ")
    expect(segment(result, "TQ1")).to eq("TQ1|1||1013044400000000&内服・経口・１日３回朝昼夕食後&JAMISDP01|||5^d|20261104|20261108")
    expect(segment(result, "RXR")).to eq("RXR|PO^口^HL70162")
  end

  it "sends CA / DEL when the order is revoked, reading the details from the upstream" do
    revoked = header.merge("status" => "revoked")
    allow(store).to receive(:search).with("MedicationRequest", hash_including("based-on" => "ServiceRequest/sr1"), limit: 200).and_return([tablet])
    transaction = ssmix2_transaction(method: "PUT", path: "/ServiceRequest/sr1", request: revoked, response: revoked)
    written = Ssmix2::Dispatcher.written_resources(transaction).first

    result = described_class.new(context: context, transaction: transaction, written: written).build

    expect(result.process).to eq("DEL")
    expect(segment(result, "ORC")).to start_with("ORC|CA|")
    expect(segments(result, "RXE").size).to eq(1)
  end

  it "keeps the cancelled lines in the CA when the whole order is revoked" do
    revoked = header.merge("status" => "revoked")
    line = tablet.merge("status" => "cancelled")
    allow(store).to receive(:search).with("MedicationRequest", hash_including("based-on" => "ServiceRequest/sr1"), limit: 200).and_return([line])
    transaction = ssmix2_transaction(method: "PUT", path: "/ServiceRequest/sr1", request: revoked, response: revoked)
    written = Ssmix2::Dispatcher.written_resources(transaction).first

    result = described_class.new(context: context, transaction: transaction, written: written).build

    expect(segment(result, "ORC")).to start_with("ORC|CA|")
    expect(segments(result, "RXE").size).to eq(1)
  end

  it "leaves out a cancelled line of an active order" do
    active = tablet.merge("id" => "mr2")
    line = tablet.merge("status" => "cancelled")
    allow(store).to receive(:search).with("MedicationRequest", hash_including("based-on" => "ServiceRequest/sr1"), limit: 200).and_return([line, active])
    transaction = ssmix2_transaction(method: "PUT", path: "/ServiceRequest/sr1", request: header, response: header)
    written = Ssmix2::Dispatcher.written_resources(transaction).first

    result = described_class.new(context: context, transaction: transaction, written: written).build

    expect(segments(result, "RXE").size).to eq(1)
  end

  it "builds an inpatient injection with RXC components, route, device-less RXR and the planned period" do
    injection = header.merge(
      "category" => [{ "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "injection" }] },
                     { "coding" => [{ "system" => F::PRESCRIPTION_SETTING_SYSTEM, "code" => "inpatient" }] },
                     { "coding" => [{ "system" => F::INJECTION_CATEGORY_SYSTEM, "code" => "regular", "display" => "定時" }] }]
    )
    dosage = { "route" => { "coding" => [{ "system" => F::ROUTE_SYSTEM, "code" => "IV", "display" => "静脈内" }] },
               "timing" => { "event" => ["2026-11-04T08:00:00+09:00"] },
               "extension" => [{ "url" => F::SCHEDULED_PERIOD_EXT_URL, "extension" => [{ "url" => "start", "valueDateTime" => "2026-11-04T08:00:00+09:00" }, { "url" => "end", "valueDateTime" => "2026-11-04T13:00:00+09:00" }] }],
               "doseAndRate" => [{ "doseQuantity" => { "value" => 500, "unit" => "mL" }, "rateQuantity" => { "value" => 100, "unit" => "mL/h" } }] }
    base = tablet.merge("id" => "mr1", "medicationCodeableConcept" => { "coding" => [{ "system" => F::MEDICINE_CODE_SYSTEM, "code" => "620007329", "display" => "ソリタ－Ｔ３号輸液５００ｍＬ" }] },
                        "dosageInstruction" => [dosage]).except("dispenseRequest")
    additive = tablet.merge("id" => "mr2", "identifier" => [{ "system" => F::RP_NUMBER_SYSTEM, "value" => "1" }, { "system" => F::ORDER_IN_RP_SYSTEM, "value" => "2" }],
                            "medicationCodeableConcept" => { "coding" => [{ "system" => F::MEDICINE_CODE_SYSTEM, "code" => "620002559", "display" => "アドナ注（静脈用）50mg" }] },
                            "dosageInstruction" => [dosage.merge("doseAndRate" => [{ "doseQuantity" => { "value" => 1, "unit" => "アンプル" } }])]).except("dispenseRequest")
    allow(store).to receive(:search).with("Encounter", anything, limit: 1).and_return([])
    transaction = bundle_transaction([injection, base, additive], %w[ServiceRequest/sr1 MedicationRequest/mr1 MedicationRequest/mr2])
    written = Ssmix2::Dispatcher.written_resources(transaction).find { |w| w.type == "ServiceRequest" }

    result = described_class.new(context: context, transaction: transaction, written: written).build

    expect(result.data_kind).to eq("OMP-02")
    orc = segment(result, "ORC").split("|")
    expect(orc[4]).to eq("#{result.order_no}_01")
    expect(orc[29]).to eq("I^入院患者オーダ^HL70482")
    rxe = segment(result, "RXE").split("|")
    expect(rxe[2]).to eq("00^一般^99I02")
    expect(rxe[3]).to eq("500")
    expect(rxe[5]).to eq("ML^ミリリットル^MR9P")
    expect(rxe[6]).to eq("INJ^注射剤^MR9P")
    expect(rxe[21]).to eq("IHP^入院処方^MR9P~regular^定時^99ZIC")
    expect(rxe[22]).to eq("H1")
    expect(rxe[23]).to eq("100")
    expect(segment(result, "TQ1")).to eq("TQ1|1||||||202611040800|202611041300")
    expect(segment(result, "RXR")).to eq("RXR|IV^静脈内^HL70162")
    rxcs = segments(result, "RXC")
    expect(rxcs[0]).to eq("RXC|B|620007329^ソリタ－Ｔ３号輸液５００ｍＬ^99ZRC|500|ML^mL^MR9P")
    expect(rxcs[1]).to eq("RXC|A|620002559^アドナ注（静脈用）50mg^99ZRC|1|AMP^アンプル^MR9P")
    expect(result.warnings).to include(a_string_matching(/HOT コードが引けない/))
  end
end
