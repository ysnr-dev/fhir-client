require "rails_helper"
require "pdf/inspector"

# 承認済のレジメンマスタ 1 件を、患者情報なしで刷る。上流からは自院の Organization だけを読む。
RSpec.describe RegimenMasterReport do
  let(:base_url) { "http://fhir.example" }
  let(:gateway) do
    FhirGateway.new(
      base_url: base_url, host_header: nil,
      token_provider: FhirTokenProvider.new(base_url: base_url, client_id: nil, client_secret: nil, host_header: nil)
    )
  end
  let(:institution) do
    { "resourceType" => "Organization", "id" => "org1", "name" => "テスト病院",
      "telecom" => [{ "system" => "phone", "value" => "03-1234-5678" }],
      "identifier" => [{ "system" => described_class::INSTITUTION_NO_SYSTEM, "value" => "1311234567" }] }
  end

  let!(:regimen) do
    Master::Regimen.create!(
      regimen_code: "000001", name: "CapeOX", purpose: "adjuvant", setting: "outpatient", emetic_risk: "moderate",
      treatment_days: 14, rest_days: 7, planned_cycles: 8, status: "approved", approved_on: "2026-09-01",
      approved_by: "pr1", discontinuation_criteria: "Grade 3 以上の非血液毒性", note: "院内の申し送り"
    )
  end

  before do
    injection = Master::RegimenStep.create!(regimen_code: "000001", name: "オキサリプラチン", usage_type: "drip",
                                            days: [1], route_code: "IV", infusion_minutes: 120,
                                            note: "血管外漏出に注意")
    oral = Master::RegimenStep.create!(regimen_code: "000001", name: "カペシタビン", usage_type: "oral",
                                       days: [1], dose_days: 14)
    Master::RegimenDrug.create!(regimen_code: "000001", step_id: injection.id, drug_role: "anticancer",
                                medicine_code: "620000001", dose_basis: "bsa", dose_value: 130, dose_unit: "mg")
    Master::RegimenDrug.create!(regimen_code: "000001", step_id: oral.id, drug_role: "anticancer",
                                medicine_code: "620000002", dose_basis: "bsa", dose_value: 2000, dose_unit: "mg",
                                dose_max: 3600)
    Master::RegimenIndication.create!(regimen_code: "000001", management_number: "20051234", name: "結腸癌", icd10: "C189")
    Master::RegimenLabCriterion.create!(regimen_code: "000001", category: "blood", item_name: "好中球数",
                                        unit: "/μL", lower_limit: 1500)
    Master::RegimenAdverseEvent.create!(regimen_code: "000001", term: "末梢性感覚ニューロパチー", grade: 2)

    stub_request(:post, "#{base_url}/").to_return(status: 200, body: {
      "resourceType" => "Bundle", "type" => "batch-response",
      "entry" => [{ "response" => { "status" => "200 OK" },
                    "resource" => { "resourceType" => "Bundle", "type" => "searchset",
                                    "entry" => [{ "resource" => institution }] } }]
    }.to_json)
  end

  # 字送りのスペースは抽出すると NBSP になるので、スペースを除いて照合する。
  def page_texts(pdf) = PDF::Inspector::Page.analyze(pdf).pages.map { |page| page[:strings].join.delete("  ") }

  it "prints the regimen with steps, criteria and the contact without internal notes" do
    text = page_texts(described_class.new(regimen.id, gateway:).generate).join

    expect(text).to include("CapeOX", "術後補助", "外来", "21日（投与14日・休薬7日）", "8クール", "中等度", "2026/09/01")
    expect(text).to include("結腸癌（C189）")
    expect(text).to include("1.オキサリプラチン", "Day1", "点滴", "静脈内", "2時間", "130mg/m²", "血管外漏出に注意")
    expect(text).to include("2.カペシタビン", "Day1から14日分", "2000mg/m²", "3600mg")
    expect(text).to include("好中球数（血液検査）", "≧1500/μL", "Grade3以上の非血液毒性", "末梢性感覚ニューロパチー（Grade2）")
    expect(text).to include("テスト病院", "TEL03-1234-5678")
    expect(text).not_to include("院内の申し送り")
  end

  it "breaks pages and repeats the step heading when the drugs continue" do
    step = Master::RegimenStep.find_by(name: "オキサリプラチン")
    60.times do |i|
      Master::RegimenDrug.create!(regimen_code: "000001", step_id: step.id, drug_role: "fluid",
                                  medicine_code: "62#{i.to_s.rjust(7, '0')}", dose_basis: "unit", dose_value: 1)
    end

    pages = page_texts(described_class.new(regimen.id, gateway:).generate)

    expect(pages.size).to eq(2)
    expect(pages[1]).to include("1.オキサリプラチン", "（続き）", "2/2")
  end

  it "refuses a regimen that is not approved" do
    regimen.update!(status: "draft")

    expect { described_class.new(regimen.id, gateway:).generate }.to raise_error(described_class::NotApproved)
  end

  it "raises NotFound for an unknown regimen" do
    expect { described_class.new(0, gateway:).generate }.to raise_error(described_class::NotFound)
  end
end
