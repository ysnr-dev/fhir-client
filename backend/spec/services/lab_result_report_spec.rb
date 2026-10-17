require "rails_helper"

# 上流アクセスが「batch Bundle POST 1 本」であること、検体検査以外を弾くこと、
# 検査分野の振り分け(施設コード・JLAC11 の読み替え)と値の表示を検証する
# (PDF 描画はレンダラが担うのでモックする)。
RSpec.describe LabResultReport do
  let(:base_url) { "http://fhir.example" }
  let(:gateway) do
    FhirGateway.new(
      base_url: base_url, host_header: nil,
      token_provider: FhirTokenProvider.new(base_url: base_url, client_id: nil, client_secret: nil, host_header: nil)
    )
  end

  let(:report) do
    {
      "resourceType" => "DiagnosticReport", "id" => "r1", "status" => "corrected",
      "category" => [
        { "coding" => [{ "system" => described_class::REPORT_CATEGORY_SYSTEM, "code" => "LAB" }] },
        { "coding" => [{ "system" => described_class::SETTING_SYSTEM, "code" => "outpatient", "display" => "外来" }] }
      ],
      "extension" => [{ "url" => described_class::ORDER_DEPARTMENT_EXT_URL,
                        "valueReference" => { "reference" => "Organization/d1", "display" => "内科" } }],
      "subject" => { "reference" => "Patient/p1" },
      "effectiveDateTime" => "2026-09-07",
      "issued" => "2026-09-07T03:00:00.000Z",
      "conclusion" => "溶血あり",
      "result" => %w[o3 o1 o2].map { |id| { "reference" => "Observation/#{id}" } }
    }
  end
  let(:patient) { { "resourceType" => "Patient", "id" => "p1" } }

  def observation(id, codings, value: nil, interpretation: nil, range: nil, note: nil)
    obs = { "resourceType" => "Observation", "id" => id, "code" => { "coding" => codings } }
    obs.merge!(value) if value
    obs["interpretation"] = [{ "coding" => [{ "system" => described_class::INTERPRETATION_SYSTEM,
                                               "code" => interpretation }] }] if interpretation
    obs["referenceRange"] = [range] if range
    obs["note"] = [{ "text" => note }] if note
    obs
  end

  def coding(system, code, display = nil) = { "system" => system, "code" => code, "display" => display }.compact

  let(:observations) do
    [
      observation("o1", [coding(described_class::RESULT_ITEM_SYSTEM, "R001", "白血球数"),
                         coding(described_class::ABBREVIATION_SYSTEM, "WBC", "WBC")],
                  value: { "valueQuantity" => { "value" => 3.0, "unit" => "X10*3/μL" } },
                  interpretation: "L", range: { "low" => { "value" => 3.3 }, "high" => { "value" => 8.6 } }),
      # 施設コードを持たない結果は JLAC11 の 12 桁で結果項目(R002 = 生化学)に読み替える。
      observation("o2", [coding(described_class::JLAC11_SYSTEM, "3B035000002327101", "AST")],
                  value: { "valueQuantity" => { "value" => 25, "unit" => "U/L" } },
                  interpretation: "N", range: { "high" => { "value" => 30 } }, note: "再検"),
      observation("o3", [coding(described_class::RESULT_ITEM_SYSTEM, "X999", "マスタに無い項目")],
                  value: { "valueString" => "陰性" })
    ]
  end

  before do
    Master::LabResultItem.create!(result_item_code: "R001", name: "白血球数", category: "血液学的検査")
    Master::LabResultItem.create!(result_item_code: "R002", name: "AST", category: "生化学検査",
                                  jlac11_code: "3B035000002327299")
  end

  def batch_entry(resource) = { "response" => { "status" => "200 OK" }, "resource" => resource }
  def searchset(resources)
    { "resourceType" => "Bundle", "type" => "searchset", "entry" => resources.map { |r| { "resource" => r } } }
  end

  def stub_batch(report_body: report, entries: nil)
    stub_request(:post, "#{base_url}/").to_return(status: 200, body: {
      "resourceType" => "Bundle", "type" => "batch-response",
      "entry" => entries || [batch_entry(searchset([report_body, patient].compact + observations)),
                             batch_entry(searchset([]))]
    }.to_json)
  end

  def capture
    captured = nil
    allow(Reports::LabResultRenderer).to receive(:new) do |args|
      captured = args
      instance_double(Reports::LabResultRenderer, render: "%PDF")
    end
    -> { captured }
  end

  it "fetches the report, results and patient in one batch" do
    stub_batch
    captured = capture

    expect(described_class.new("r1", gateway: gateway).generate).to eq("%PDF")
    expect(captured.call[:layout_path]).to eq(described_class::LAYOUT_PATH)
    expect(captured.call[:patient]).to eq(patient)
    expect(
      a_request(:post, "#{base_url}/").with { |req|
        JSON.parse(req.body)["entry"].first.dig("request", "url") ==
          "DiagnosticReport?_id=r1&_include=DiagnosticReport%3Aresult&_include=DiagnosticReport%3Asubject"
      }
    ).to have_been_made.once
  end

  it "groups results by category in the master order and formats each line" do
    stub_batch
    captured = capture
    described_class.new("r1", gateway: gateway).generate

    groups = captured.call[:groups]
    expect(groups.map(&:category)).to eq(%w[血液学的検査 生化学検査 その他])
    wbc, ast, other = groups.map { |group| group.lines.first }
    expect(wbc.to_h).to include(name: "WBC", value: "3", unit: "X10*3/μL", flag: "L", range: "3.3〜8.6")
    expect(ast.to_h).to include(name: "AST", value: "25", flag: "", range: "〜30", note: "再検")
    expect(other.to_h).to include(name: "マスタに無い項目", value: "陰性", unit: "")

    summary = captured.call[:summary]
    expect(summary.to_h).to include(date: "2026/09/07", setting: "外来", department: "内科",
                                    status: "訂正報告", issued: "2026/09/07 12:00", conclusion: "溶血あり")
  end

  it "raises NotLabResult for microbiology reports" do
    micro = report.merge("category" => [{ "coding" => [{ "system" => described_class::REPORT_CATEGORY_SYSTEM,
                                                           "code" => "MB" }] }])
    stub_batch(report_body: micro)
    expect { described_class.new("r1", gateway: gateway).generate }.to raise_error(described_class::NotLabResult)
  end

  it "raises NotFound when the report does not exist" do
    stub_batch(report_body: nil)
    expect { described_class.new("r1", gateway: gateway).generate }.to raise_error(described_class::NotFound)
  end

  it "raises UpstreamError when a batch entry fails" do
    stub_batch(entries: [{ "response" => { "status" => "500" } }, batch_entry(searchset([]))])
    expect { described_class.new("r1", gateway: gateway).generate }.to raise_error(described_class::UpstreamError)
  end
end
