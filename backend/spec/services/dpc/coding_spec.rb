require "rails_helper"
require "support/billing_fhir_fixtures"

RSpec.describe Dpc::Coding do
  before(:context) do
    MasterImport::DpcTableImporter.call(File.open(Rails.root.join("spec/fixtures/files/dpc_tables_sample.xlsx")))
  end

  after(:context) do
    ActiveRecord::Base.connection.tables.grep(/\Amaster_dpc_/).each do |table|
      ActiveRecord::Base.connection.execute("DELETE FROM #{table}")
    end
  end

  let(:store) { BillingFhirFixtures::FakeStore.new }

  let(:encounter) do
    {
      "resourceType" => "Encounter", "id" => "enc-1", "status" => "finished", "class" => { "code" => "IMP" },
      "subject" => { "reference" => "Patient/pat-1" },
      "period" => { "start" => "2026-09-01T10:00:00+09:00", "end" => "2026-09-10T11:00:00+09:00" }
    }
  end

  before do
    store.add(encounter, { "resourceType" => "Patient", "id" => "pat-1", "birthDate" => "1955-09-02" })
    medical_procedure!("150254110", name: "腹腔鏡下胆嚢摘出術", chapter: "K", section: "672", code_table_branch: "02")
    medical_procedure!("150233410", name: "閉鎖循環式全身麻酔５", chapter: "L", section: "008", code_table_item: "005")
  end

  def code(inputs = {}, overrides = {})
    described_class.new(encounter_id: "enc-1", inputs: inputs, overrides: overrides, store: store).call
  end

  def branch(result, key)
    result[:branches].find { |b| b[:key] == key }
  end

  it "入院期間の手術の実施記録から手術の分岐を決め、点数と入院期間を添える" do
    store.add(procedure_hub(order_type: "surgery", code: "150254110", date: "2026-09-02"),
              child_procedure(order_type: "surgery", code: "150233410", date: "2026-09-02"))

    result = code({ icd10: "K802" })

    expect(branch(result, "surgery")).to include(value: "02", status: "auto")
    expect(branch(result, "surgery")[:evidence].first).to include(code: "K672-2", ref: "Procedure/proc-1", date: "2026-09-02")
    expect(result[:edition]).to eq("20260601")
    expect(result[:base_date]).to eq("2026-09-10")
    expect(result[:stay]).to eq(admitted_on: "2026-09-01", discharged_on: "2026-09-10", days: 10)
    expect(result[:result]).to include(dpc_code: "060330xx02xxxx", bundled: true)
    expect(result[:result][:period_ends].first).to match(/\A2026-09-/)
  end

  it "在院日数ぶん期間ごとの点数を足し、期間Ⅲを超えた日は数えない" do
    result = code({ icd10: "C182" })
    row = result[:result]
    days, points = row[:days], row[:points]
    expected = (1..10).sum do |day|
      if day <= days[0] then points[0]
      elsif day <= days[1] then points[1]
      elsif day <= days[2] then points[2]
      else 0
      end
    end

    expect(row[:estimated_points]).to eq(expected)
  end

  it "同じ分類の全 14 桁を並べ、判定と合うものと今の結果に印を付ける" do
    result = code({ icd10: "C182" })

    expect(result[:simulation].size).to be > 5
    expect(result[:simulation].select { |s| s[:current] }.map { |s| s[:dpc_code] }).to eq(["060035xx99x0xx"])
  end

  it "様式1 の手術情報も手術の根拠にする" do
    result = code({ icd10: "K802", surgeries: [{ k_code: "K672-2", date: "2026-09-03", name: "腹腔鏡下胆嚢摘出術" }] })

    expect(branch(result, "surgery")[:evidence].first).to include(source: "form1", code: "K672-2")
  end

  it "中心静脈の注射を G005 として処置等2 に数え、麻酔チャートの薬剤は数えない" do
    store.add(procedure_hub(order_type: "injection", code: nil, id: "inj-1", date: "2026-09-03"),
              administration(code: "620000001", dose: 1, hub: "inj-1", method: "31"),
              procedure_hub(order_type: "anesthesia-chart", code: nil, id: "anes-1", date: "2026-09-02"),
              administration(code: "620000002", dose: 1, hub: "anes-1", method: "31", id: "ma-anes"))

    result = code({ icd10: "C182" })

    evidence = branch(result, "proc2")[:evidence]
    expect(evidence.map { |e| e[:ref] }).to eq(["MedicationAdministration/ma-620000001"])
    expect(branch(result, "proc2")[:value]).to eq("1")
  end

  it "入院時の満年齢を生年月日から数える" do
    result = code({ icd10: "J189", pneumonia_category: "5", adrop: 2 })

    # 1955-09-02 生まれは 2026-09-01 の入院時に 70 歳。
    expect(branch(result, "age")[:evidence].first[:note]).to eq("年齢 70")
  end

  it "医療機関別係数は基準日に有効なものを返す" do
    settings = FacilitySettings.current
    settings.apply_settings("dpc_coefficients" => { "2026-06-01" => "1.4012", "2026-10-01" => "1.5000" })
    settings.save!

    expect(code({ icd10: "C182" })[:coefficient]).to eq(from: "2026-06-01", value: "1.4012")
  end

  it "入院が無ければ NotFound" do
    expect { described_class.new(encounter_id: "nope", inputs: {}, overrides: {}, store: store).call }
      .to raise_error(described_class::NotFound)
  end
end
