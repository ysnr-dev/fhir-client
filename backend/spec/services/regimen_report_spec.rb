require "rails_helper"
require "pdf/inspector"

# 上流アクセス(ヘッダの batch + 日オーダーの検索)、日オーダーの読み取り(クール・Day・進捗・
# ステップ)、マスタの算出基準の引き当て、実 PDF への流し込みを見る。
RSpec.describe RegimenReport do
  let(:base_url) { "http://fhir.example" }
  let(:gateway) do
    FhirGateway.new(
      base_url: base_url, host_header: nil,
      token_provider: FhirTokenProvider.new(base_url: base_url, client_id: nil, client_secret: nil, host_header: nil)
    )
  end
  let(:instance_id) { "inst-1" }

  let(:header) do
    {
      "resourceType" => "ServiceRequest", "id" => "h1", "status" => "active", "intent" => "plan",
      "category" => [
        { "coding" => [{ "system" => described_class::ORDER_TYPE_SYSTEM, "code" => "chemo-regimen" }] },
        { "coding" => [{ "system" => PrescriptionReport::SETTING_SYSTEM, "code" => "outpatient", "display" => "外来" }] }
      ],
      "code" => { "coding" => [{ "system" => described_class::REGIMEN_CODE_SYSTEM, "code" => "000001",
                                 "display" => "CapeOX" }] },
      "identifier" => [{ "system" => described_class::REGIMEN_INSTANCE_SYSTEM, "value" => instance_id }],
      "subject" => { "reference" => "Patient/p1" },
      "occurrenceDateTime" => "2026-10-01",
      "reasonReference" => [{ "display" => "直腸癌" }],
      "requester" => { "display" => "児玉 義憲" },
      "extension" => [
        { "url" => described_class::REGIMEN_EXT_URL, "extension" => [
          { "url" => "cycleDays", "valueInteger" => 21 }, { "url" => "treatmentDays", "valueInteger" => 14 },
          { "url" => "plannedCycles", "valueInteger" => 8 }, { "url" => "bsa", "valueDecimal" => 1.55 },
          { "url" => "height", "valueDecimal" => 165 }, { "url" => "weight", "valueDecimal" => 51 }
        ] }
      ]
    }
  end
  let(:patient) do
    { "resourceType" => "Patient", "id" => "p1", "birthDate" => "1960-01-01", "gender" => "female",
      "name" => [{ "family" => "がん", "given" => ["花子"] }], "identifier" => [{ "value" => "26" }] }
  end
  let(:institution) do
    { "resourceType" => "Organization", "id" => "org1", "name" => "テスト病院",
      "telecom" => [{ "system" => "phone", "value" => "03-1234-5678" }],
      "identifier" => [{ "system" => described_class::INSTITUTION_NO_SYSTEM, "value" => "1311234567" }] }
  end

  let!(:master) do
    Master::Regimen.create!(regimen_code: "000001", name: "CapeOX", purpose: "adjuvant", emetic_risk: "moderate",
                            treatment_days: 14, rest_days: 7)
  end
  let!(:injection_step) do
    Master::RegimenStep.create!(regimen_code: "000001", name: "オキサリプラチン", usage_type: "drip", days: [1])
  end
  let!(:oral_step) do
    Master::RegimenStep.create!(regimen_code: "000001", name: "カペシタビン", usage_type: "oral", days: [1])
  end
  let!(:oxaliplatin) do
    Master::RegimenDrug.create!(regimen_code: "000001", step_id: injection_step.id, drug_role: "anticancer",
                                medicine_code: "620000001", dose_basis: "bsa", dose_value: 130, dose_unit: "mg")
  end
  let!(:capecitabine) do
    Master::RegimenDrug.create!(regimen_code: "000001", step_id: oral_step.id, drug_role: "anticancer",
                                medicine_code: "620000002", dose_basis: "bsa", dose_value: 2000, dose_unit: "mg")
  end

  def regimen_order(id, kind:, date:, cycle:, day:, reduction: nil, body: nil)
    parts = [
      { "url" => "regimen", "valueReference" => { "reference" => "ServiceRequest/h1" } },
      { "url" => "cycle", "valueInteger" => cycle }, { "url" => "day", "valueInteger" => day },
      { "url" => "code", "valueString" => "000001" }, { "url" => "name", "valueString" => "CapeOX" }
    ]
    parts << { "url" => "reduction", "valueString" => reduction } if reduction
    body&.each { |key, value| parts << { "url" => key.to_s, "valueDecimal" => value } }
    {
      "resourceType" => "ServiceRequest", "id" => id, "status" => "active",
      "category" => [{ "coding" => [{ "system" => described_class::ORDER_TYPE_SYSTEM, "code" => kind }] }],
      "subject" => { "reference" => "Patient/p1" }, "occurrenceDateTime" => date,
      "requisition" => { "system" => described_class::REGIMEN_INSTANCE_SYSTEM, "value" => instance_id },
      "extension" => [{ "url" => described_class::REGIMEN_ORDER_EXT_URL, "extension" => parts }]
    }
  end

  # drug_id はマスタの薬剤 id。保存し直したマスタでは引けない id になる(医薬品コードで引き当てる)。
  def medication_request(id, order_id, name:, code:, dose:, unit:, comment:, drug_id:, rp: 1, supply_days: nil)
    dosage = { "doseAndRate" => [{ "doseQuantity" => { "value" => dose, "unit" => unit } }],
               "additionalInstruction" => [{ "text" => comment }] }
    if supply_days
      dosage["timing"] = { "code" => { "text" => "１日２回朝夕食後　服用" } }
    else
      dosage["text"] = "点滴 静脈内"
    end
    mr = {
      "resourceType" => "MedicationRequest", "id" => id,
      "basedOn" => [{ "reference" => "ServiceRequest/#{order_id}" }],
      "identifier" => [{ "system" => described_class::RP_NUMBER_SYSTEM, "value" => rp.to_s },
                       { "system" => described_class::ORDER_IN_RP_SYSTEM, "value" => "1" }],
      "medicationCodeableConcept" => { "coding" => [{ "system" => described_class::MEDICINE_CODE_SYSTEM,
                                                        "code" => code, "display" => name }] },
      "dosageInstruction" => [dosage],
      "extension" => [{ "url" => described_class::REGIMEN_DOSE_EXT_URL, "extension" => [
        { "url" => "drug", "valueInteger" => drug_id }, { "url" => "ratio", "valueDecimal" => 80 },
        { "url" => "bsa", "valueDecimal" => 1.6 }
      ] }]
    }
    mr["dispenseRequest"] = { "expectedSupplyDuration" => { "value" => supply_days } } if supply_days
    mr
  end

  def task(order_id, code, status)
    { "resourceType" => "Task", "id" => "t-#{order_id}-#{code}", "status" => status,
      "focus" => { "reference" => "ServiceRequest/#{order_id}" },
      "code" => { "coding" => [{ "system" => described_class::TASK_CODE_SYSTEM, "code" => code }] } }
  end

  let(:day_orders) do
    [
      regimen_order("i1", kind: "injection", date: "2026-10-01", cycle: 1, day: 1),
      regimen_order("o1", kind: "prescription", date: "2026-10-01", cycle: 1, day: 1),
      regimen_order("i2", kind: "injection", date: "2026-10-22", cycle: 2, day: 1, reduction: "好中球減少"),
      regimen_order("o2", kind: "prescription", date: "2026-10-22", cycle: 2, day: 1),
      medication_request("m1", "i1", name: "オキサリプラチン注", code: "620000001", dose: 201.5, unit: "mg",
                                     comment: "オキサリプラチン / 点滴時間 120 分(2 時間) / 血管外漏出注意",
                                     drug_id: oxaliplatin.id),
      medication_request("m2", "o1", name: "カペシタビン錠", code: "620000002", dose: 3100, unit: "mg",
                                     comment: "カペシタビン / 朝夕食後", drug_id: capecitabine.id, supply_days: 14),
      medication_request("m3", "i2", name: "オキサリプラチン注", code: "620000001", dose: 161.2, unit: "mg",
                                     comment: "オキサリプラチン / 点滴時間 120 分(2 時間)", drug_id: 999_999),
      medication_request("m4", "o2", name: "カペシタビン錠", code: "620000002", dose: 3100, unit: "mg",
                                     comment: "カペシタビン / 朝夕食後", drug_id: 999_998, supply_days: 14),
      task("i1", "injection", "completed"),
      task("o2", "rx-dispense", "cancelled"),
      # 化学療法の当日確認など、進捗以外の Task は見ない。
      task("i2", "chemo-go", "completed")
    ]
  end

  def batch_entry(resource) = { "response" => { "status" => "200 OK" }, "resource" => resource }
  def searchset(resources, link: [])
    { "resourceType" => "Bundle", "type" => "searchset", "link" => link,
      "entry" => resources.map { |r| { "resource" => r } } }
  end

  def stub_header(header_body: header)
    stub_request(:post, "#{base_url}/").to_return(status: 200, body: {
      "resourceType" => "Bundle", "type" => "batch-response",
      "entry" => [batch_entry(searchset([header_body, patient].compact)), batch_entry(searchset([institution]))]
    }.to_json)
  end

  def stub_day_orders(resources = day_orders, link: [])
    stub_request(:get, %r{\A#{base_url}/ServiceRequest\?})
      .to_return(status: 200, body: searchset(resources, link:).to_json)
  end

  # 字送りのスペースは抽出すると NBSP になるので、スペースを除いて照合する。
  def page_texts(pdf) = PDF::Inspector::Page.analyze(pdf).pages.map { |page| page[:strings].join.delete(" \u00A0") }

  it "searches the day orders by the instance id with details and progress tasks" do
    stub_header
    stub_day_orders
    # WebMock は同じキーのパラメータ(_revinclude × 2)を 1 つに畳んで記録するので、
    # gateway に渡したクエリ文字列そのものを見る。
    queries = []
    allow(gateway).to receive(:forward).and_wrap_original do |original, **args|
      queries << args[:query] if args[:method] == :get
      original.call(**args)
    end
    described_class.new("h1", gateway: gateway).generate_plan

    query = URI.decode_www_form(queries.sole)
    expect(query).to include(["requisition", "#{described_class::REGIMEN_INSTANCE_SYSTEM}|#{instance_id}"])
    expect(query).to include(%w[_revinclude MedicationRequest:based-on]).and include(%w[_revinclude Task:focus])
  end

  it "prints the requested cycle with the master basis, dose and progress" do
    stub_header
    stub_day_orders
    pdf = described_class.new("h1", gateway: gateway).generate_plan(cycle: "1")
    text = page_texts(pdf).join

    expect(text).to include("第1クール").and include("CapeOX").and include("術後補助").and include("中等度")
    expect(text).to include("2026/10/01〜2026/10/21")
    expect(text).to include("130mg/m²").and include("201.5mg").and include("80%")
    expect(text).to include("［実施済］").and include("14日分").and include("血管外漏出注意")
    # 明細の体表面積(このクールで使った値)を優先する。
    expect(text).to include("1.6m²")
    expect(text).not_to include("161.2mg")
  end

  it "defaults to the last cycle and resolves the master drug by medicine code when the id is stale" do
    stub_header
    stub_day_orders
    text = page_texts(described_class.new("h1", gateway: gateway).generate_plan).join

    expect(text).to include("第2クール").and include("161.2mg").and include("130mg/m²").and include("2000mg/m²")
    expect(text).to include("減量:好中球減少").and include("［中止］")
  end

  it "prints the body stamped on the day orders of the cycle" do
    stub_header
    stub_day_orders([
      regimen_order("i1", kind: "injection", date: "2026-10-01", cycle: 1, day: 1,
                          body: { height: 165, weight: 58, bsa: 1.64 }),
      regimen_order("i2", kind: "injection", date: "2026-10-22", cycle: 2, day: 1)
    ])
    text = page_texts(described_class.new("h1", gateway: gateway).generate_plan(cycle: "1")).join

    expect(text).to include("体重58kg").and include("1.64m²")
    expect(text).not_to include("体重51kg")
  end

  it "raises CycleNotFound for an unregistered cycle" do
    stub_header
    stub_day_orders
    expect { described_class.new("h1", gateway: gateway).generate_plan(cycle: "5") }
      .to raise_error(described_class::CycleNotFound)
  end

  it "prints the schedule by month with oral days, rest days and without cancelled orders" do
    stub_header
    stub_day_orders
    pages = page_texts(described_class.new("h1", gateway: gateway).generate_schedule)

    # 10/1 〜 C2 の最終日(11/11)。
    expect(pages.size).to eq(2)
    expect(pages[0]).to include("2026年10月").and include("がん花子様").and include("TEL03-1234-5678")
    expect(pages[0]).to include("C1Day1").and include("点滴:オキサリプラチン").and include("C1Day14")
    expect(pages[0]).to include("休薬")
    # C2 の内服(10/22〜)は中止したので出さない。注射は出す。
    expect(pages[0]).to include("C2Day1")
    expect(pages[0].scan("内服:カペシタビン").size).to eq(14)
    expect(pages[1]).to include("2026年11月")
  end

  it "ignores day orders of other applications" do
    other = regimen_order("x1", kind: "injection", date: "2026-09-01", cycle: 1, day: 1)
    other["extension"][0]["extension"][0]["valueReference"]["reference"] = "ServiceRequest/other"
    stub_header
    stub_day_orders(day_orders + [other])
    pages = page_texts(described_class.new("h1", gateway: gateway).generate_schedule)
    expect(pages.first).to include("2026年10月")
  end

  it "raises NotRegimenOrder for a non-regimen order" do
    stub_header(header_body: header.merge("category" => []))
    expect { described_class.new("h1", gateway: gateway).generate_plan }
      .to raise_error(described_class::NotRegimenOrder)
  end

  it "raises NotFound when the header does not exist" do
    stub_header(header_body: nil)
    expect { described_class.new("h1", gateway: gateway).generate_plan }.to raise_error(described_class::NotFound)
  end

  it "raises NoDayOrders when every cycle has been deleted" do
    stub_header
    stub_day_orders([])
    expect { described_class.new("h1", gateway: gateway).generate_schedule }
      .to raise_error(described_class::NoDayOrders)
  end

  it "refuses to print a partial plan when the search has a next page" do
    stub_header
    stub_day_orders(day_orders, link: [{ "relation" => "next", "url" => "#{base_url}/ServiceRequest?page=2" }])
    expect { described_class.new("h1", gateway: gateway).generate_plan }
      .to raise_error(described_class::TooManyOrders)
  end
end
