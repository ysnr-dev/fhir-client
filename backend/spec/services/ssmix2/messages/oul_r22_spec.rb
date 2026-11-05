require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::OulR22 do
  F = Ssmix2::Fhir unless defined?(F)
  let(:specimen) do
    { "resourceType" => "Specimen", "id" => "sp1", "accessionIdentifier" => { "value" => "000000001219001" },
      "type" => { "coding" => [{ "system" => F::JLAC11_SPECIMEN_SYSTEM, "code" => "023", "display" => "血清" }] },
      "collection" => { "collectedDateTime" => "2026-11-03" } }
  end
  def observation(id, code, name, value, unit, flag, range: nil)
    { "resourceType" => "Observation", "id" => id, "status" => "final", "specimen" => { "reference" => "Specimen/sp1" },
      "code" => { "coding" => [{ "system" => F::RESULT_ITEM_SYSTEM, "code" => code, "display" => name },
                               { "system" => F::JLAC10_SYSTEM, "code" => "3A010000002327101", "display" => name },
                               { "system" => F::ABBREVIATION_SYSTEM, "code" => code, "display" => code }], "text" => name },
      "effectiveDateTime" => "2026-11-03",
      "valueQuantity" => { "value" => value, "unit" => unit, "system" => F::UCUM_SYSTEM, "code" => "g/dL" },
      "interpretation" => [{ "coding" => [{ "system" => F::INTERPRETATION_SYSTEM, "code" => flag }] }],
      "referenceRange" => range && [{ "low" => { "value" => range[0] }, "high" => { "value" => range[1] }, "text" => "#{range[0]}-#{range[1]}" }] }.compact
  end
  let(:report) do
    { "resourceType" => "DiagnosticReport", "id" => "dr1", "status" => "corrected", "subject" => { "reference" => "Patient/p1" },
      "category" => [{ "coding" => [{ "code" => "LAB" }] }, { "coding" => [{ "system" => F::LAB_RESULT_SETTING_SYSTEM, "code" => "outpatient" }] }],
      "effectiveDateTime" => "2026-11-03", "issued" => "2026-11-04T10:30:59+09:00",
      "basedOn" => [{ "reference" => "ServiceRequest/lab1" }], "specimen" => [{ "reference" => "Specimen/sp1" }],
      "result" => [{ "reference" => "Observation/o1" }, { "reference" => "Observation/o2" }],
      "extension" => [{ "url" => F::ORDER_DEPARTMENT_EXT_URL, "valueReference" => { "reference" => "Organization/dept1" } }] }
  end
  let(:o1) { observation("o1", "TP", "総蛋白", 7.2, "g/dL", "N", range: [6.7, 8.3]) }
  let(:o2) { observation("o2", "ALB", "アルブミン", 3.1, "g/dL", "L", range: [3.7, 5.5]).merge("note" => [{ "text" => "再検" }]) }
  let(:store) do
    ssmix2_store({ "Patient/p1" => ssmix2_patient, "Organization/dept1" => ssmix2_department },
                 searches: { ["Observation", { "_id" => "o1,o2" }] => [o1, o2], ["Specimen", { "_id" => "sp1" }] => [specimen] })
  end
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }

  before { ssmix2_enable! }

  it "builds OUL^R22 with the specimen, the report status and one OBX per result" do
    transaction = ssmix2_transaction(method: "PUT", path: "/DiagnosticReport/dr1", request: report, response: report)
    written = Ssmix2::Dispatcher.written_resources(transaction).first

    result = described_class.new(context: context, transaction: transaction, written: written).build

    expect(result.data_kind).to eq("OML-11")
    expect(result.service_date).to eq("20261103")
    expect(result.order_no).to eq(Ssmix2::OrderNumber.for("ServiceRequest/lab1"))
    expect(segment(result, "MSH")).to include("|OUL^R22^OUL_R22|")
    expect(segment(result, "SPM")).to eq("SPM|1|000000001219001||023^血清^JC11|||||||||||||20261103")
    obr = segment(result, "OBR").split("|")
    expect(obr[3]).to eq("dr1")
    expect(obr[7]).to eq("20261103")
    expect(obr[22]).to eq("20261104103059")
    expect(obr[25]).to eq("C")
    orc = segment(result, "ORC").split("|")
    expect(orc[1]).to eq("SC")
    expect(orc[3]).to eq("dr1")
    expect(orc[5]).to eq("CM")
    obxs = segments(result, "OBX")
    expect(obxs[0]).to eq("OBX|1|NM|3A010000002327101^総蛋白^JC10^TP^TP^99X03||7.2|g/dL^g/dL^UCUM|6.7-8.3|N|||F|||20261103")
    expect(obxs[1]).to eq("OBX|2|NM|3A010000002327101^アルブミン^JC10^ALB^ALB^99X03||3.1|g/dL^g/dL^UCUM|3.7-5.5|L|||F|||20261103")
    expect(segment(result, "NTE")).to eq("NTE|1||再検")
  end

  # 受信側(検査結果取込)の経路で読み戻す。ファイルと同じ CP50221 のバイト列にしてから、
  # LabImport::TextDecoder で復号し、LabImport::Hl7Parser で中間表現にする。
  describe "reading the message back with the lab result importer" do
    let(:urine) do
      { "resourceType" => "Specimen", "id" => "sp2", "accessionIdentifier" => { "value" => "000000001219002" },
        "type" => { "coding" => [{ "system" => F::JLAC11_SPECIMEN_SYSTEM, "code" => "001", "display" => "尿" }] },
        "collection" => { "collectedDateTime" => "2026-11-03T08:15:00+09:00" } }
    end
    let(:protein) do
      { "resourceType" => "Observation", "id" => "o3", "status" => "final", "specimen" => { "reference" => "Specimen/sp2" },
        "code" => { "coding" => [{ "system" => F::RESULT_ITEM_SYSTEM, "code" => "UPRO", "display" => "尿蛋白" },
                                 { "system" => F::JLAC11_SYSTEM, "code" => "1A0100000000101", "display" => "尿蛋白" }] },
        "effectiveDateTime" => "2026-11-03",
        "valueCodeableConcept" => { "coding" => [{ "code" => "2+", "display" => "（２＋）" }] },
        "interpretation" => [{ "coding" => [{ "system" => F::INTERPRETATION_SYSTEM, "code" => "A" }] }] }
    end
    let(:remark) do
      { "resourceType" => "Observation", "id" => "o4", "status" => "preliminary", "specimen" => { "reference" => "Specimen/sp2" },
        "code" => { "coding" => [{ "system" => F::RESULT_ITEM_SYSTEM, "code" => "UCOM", "display" => "尿所見" }] },
        "effectiveDateTime" => "2026-11-03",
        "valueString" => "混濁 | 赤褐色 ^ 沈渣 & 再検 ~ 要",
        "note" => [{ "text" => "①採取後 2 時間\n室温保存" }] }
    end
    let(:two_specimen_report) do
      report.merge("specimen" => [{ "reference" => "Specimen/sp1" }, { "reference" => "Specimen/sp2" }],
                   "result" => %w[o1 o2 o3 o4].map { |id| { "reference" => "Observation/#{id}" } })
    end
    let(:store) do
      ssmix2_store({ "Patient/p1" => ssmix2_patient, "Organization/dept1" => ssmix2_department },
                   searches: { ["Observation", { "_id" => "o1,o2,o3,o4" }] => [o1, o2, protein, remark],
                               ["Specimen", { "_id" => "sp1,sp2" }] => [specimen, urine] })
    end

    def read_back(result)
      encoded = Ssmix2::Hl7::Charset.encode(result.hl7)
      expect(encoded.dropped).to be_empty
      decoded = LabImport::TextDecoder.decode(encoded.bytes)
      expect(decoded.encoding).to eq("ISO-2022-JP")
      LabImport::Hl7Parser.new(decoded.text).parse
    end

    it "gives the importer the same patient, specimens, orders and values" do
      transaction = ssmix2_transaction(method: "PUT", path: "/DiagnosticReport/dr1", request: two_specimen_report,
                                       response: two_specimen_report)
      written = Ssmix2::Dispatcher.written_resources(transaction).first
      result = described_class.new(context: context, transaction: transaction, written: written).build

      message = read_back(result)

      expect(message.message_type).to eq("OUL^R22")
      expect(message.source).to eq("2219999998")
      expect(message.reports.size).to eq(2)
      serum, urine_report = message.reports

      [serum, urine_report].each do |parsed|
        expect(parsed.patient.number).to eq(segment(result, "PID").split("|")[3].split("^").first)
        expect(parsed.patient.name).to eq("患者　太郎")
        expect(parsed.patient.birth_date).to eq(Date.new(1948, 4, 5))
        expect(parsed.patient.sex).to eq("M")
        expect(parsed.patient.setting).to eq("outpatient")
        expect(parsed.placer_order_number).to eq(result.order_no)
        expect(parsed.filler_order_number).to eq("dr1")
        expect(parsed.status).to eq("C")
        expect(parsed.reported_at).to eq(Time.zone.parse("2026-11-04T10:30:59+09:00"))
      end

      expect(serum.specimens.map(&:ids)).to eq([["000000001219001"]])
      expect(serum.specimens.first.material_code).to eq("023")
      expect(serum.specimens.first.material_name).to eq("血清")
      expect(serum.observations.map { |o| [o.code, o.jlac10, o.value, o.unit, o.reference_range, o.abnormal_flag, o.status] })
        .to eq([["3A010000002327101", "3A010000002327101", "7.2", "g/dL", "6.7-8.3", "N", "F"],
                ["3A010000002327101", "3A010000002327101", "3.1", "g/dL", "3.7-5.5", "L", "F"]])
      expect(serum.observations.map(&:name)).to eq(%w[総蛋白 アルブミン])
      expect(serum.observations.last.notes).to eq(["再検"])

      expect(urine_report.specimens.map(&:ids)).to eq([["000000001219002"]])
      expect(urine_report.specimens.first.material_name).to eq("尿")
      expect(urine_report.specimens.first.collected_at).to eq(Time.zone.parse("2026-11-03T08:15:00+09:00"))
      upro, ucom = urine_report.observations
      expect([upro.value_type, upro.jlac11, upro.value, upro.value_text, upro.abnormal_flag])
        .to eq(["CWE", "1A0100000000101", "2+", "（２＋）", "A"])
      expect([ucom.value_type, ucom.code, ucom.value, ucom.status]).to eq(["ST", "UCOM", "混濁 | 赤褐色 ^ 沈渣 & 再検 ~ 要", "P"])
      expect(ucom.notes).to eq(["①採取後 2 時間\n室温保存"])
    end
  end
end
