require "rails_helper"

# 上流アクセスが「batch Bundle POST 1 本」であること、下書き・別の文書を弾くこと、
# 入院の情報・記録の情報・セクションの本文の組み立てを検証する(PDF 描画はレンダラが担うのでモックする)。
RSpec.describe DischargeSummaryReport do
  let(:base_url) { "http://fhir.example" }
  let(:gateway) do
    FhirGateway.new(
      base_url: base_url, host_header: nil,
      token_provider: FhirTokenProvider.new(base_url: base_url, client_id: nil, client_secret: nil, host_header: nil)
    )
  end

  def div(inner) = %(<div xmlns="http://www.w3.org/1999/xhtml">#{inner}</div>)

  let(:composition) do
    {
      "resourceType" => "Composition", "id" => "c1", "status" => "amended",
      "type" => { "coding" => [{ "system" => "http://loinc.org", "code" => "18842-5" }] },
      "title" => "退院時サマリー", "date" => "2026-09-17T22:29:00+09:00",
      "subject" => { "reference" => "Patient/p1" }, "encounter" => { "reference" => "Encounter/e1" },
      "author" => [{ "display" => "児玉 義憲" }],
      "attester" => [{ "mode" => "legal", "time" => "2026-09-17T13:30:22.022Z", "party" => { "display" => "医師 一郎" } }],
      "extension" => [{ "url" => described_class::ORDER_DEPARTMENT_EXT_URL,
                        "valueReference" => { "display" => "内科" } }],
      "section" => [
        { "title" => "退院時診断", "text" => { "div" => div("<p>なし</p>") } },
        { "title" => "入院経過", "text" => { "div" => div("<p>08/25 入院</p><p>09/17 退院</p>") } },
        { "title" => "退院後の方針", "text" => { "div" => div("<p></p>") } }
      ]
    }
  end
  let(:patient) { { "resourceType" => "Patient", "id" => "p1" } }
  let(:encounter) do
    {
      "resourceType" => "Encounter", "id" => "e1",
      "period" => { "start" => "2026-08-25", "end" => "2026-09-17T22:28:00+09:00" },
      "serviceProvider" => { "display" => "内科" },
      "participant" => [{ "type" => [{ "coding" => [{ "system" => described_class::PARTICIPATION_TYPE_SYSTEM,
                                                       "code" => "ATND" }] }],
                          "individual" => { "display" => "児玉 義憲" } }],
      "hospitalization" => { "dischargeDisposition" => {
        "coding" => [{ "system" => described_class::DISCHARGE_DISPOSITION_SYSTEM, "code" => "home" }]
      } }
    }
  end

  def batch_entry(resource) = { "response" => { "status" => "200 OK" }, "resource" => resource }
  def searchset(resources)
    { "resourceType" => "Bundle", "type" => "searchset", "entry" => resources.map { |r| { "resource" => r } } }
  end

  def stub_batch(composition_body: composition, entries: nil)
    stub_request(:post, "#{base_url}/").to_return(status: 200, body: {
      "resourceType" => "Bundle", "type" => "batch-response",
      "entry" => entries || [batch_entry(searchset([composition_body, patient, encounter].compact)),
                             batch_entry(searchset([]))]
    }.to_json)
  end

  def capture
    captured = nil
    allow(Reports::DischargeSummaryRenderer).to receive(:new) do |args|
      captured = args
      instance_double(Reports::DischargeSummaryRenderer, render: "%PDF")
    end
    -> { captured }
  end

  it "fetches the summary with its patient and admission in one batch" do
    stub_batch
    captured = capture

    expect(described_class.new("c1", gateway: gateway).generate).to eq("%PDF")
    expect(captured.call[:layout_path]).to eq(described_class::LAYOUT_PATH)
    expect(captured.call[:patient]).to eq(patient)
    expect(
      a_request(:post, "#{base_url}/").with { |req|
        JSON.parse(req.body)["entry"].first.dig("request", "url") ==
          "Composition?_id=c1&_include=Composition%3Asubject&_include=Composition%3Aencounter"
      }
    ).to have_been_made.once
  end

  it "builds the admission, record and sections" do
    stub_batch
    captured = capture
    described_class.new("c1", gateway: gateway).generate

    expect(captured.call[:admission].to_h).to eq(
      admitted: "2026/08/25", discharged: "2026/09/17", stay_days: 24, department: "内科",
      attending: "児玉 義憲", disposition: "自宅"
    )
    expect(captured.call[:record].to_h).to eq(
      recorded_at: "2026/09/17 22:29", status: "修正済み", author: "児玉 義憲",
      attester: "医師 一郎", attested_at: "2026/09/17 22:30", department: "内科"
    )
    # 本文の無いセクション(退院後の方針)は出さない。
    expect(captured.call[:sections].map(&:to_h)).to eq([
      { title: "退院時診断", paragraphs: ["なし"] },
      { title: "入院経過", paragraphs: ["08/25 入院", "09/17 退院"] }
    ])
  end

  it "prints with an empty admission when the encounter is not included" do
    stub_batch(entries: [batch_entry(searchset([composition, patient])), batch_entry(searchset([]))])
    captured = capture
    described_class.new("c1", gateway: gateway).generate

    expect(captured.call[:admission].admitted).to be_nil
  end

  it "raises Draft for a summary still being written" do
    stub_batch(composition_body: composition.merge("status" => "preliminary"))
    expect { described_class.new("c1", gateway: gateway).generate }.to raise_error(described_class::Draft)
  end

  it "raises NotDischargeSummary for other notes" do
    note = composition.merge("type" => { "coding" => [{ "system" => "http://loinc.org", "code" => "11506-3" }] })
    stub_batch(composition_body: note)
    expect { described_class.new("c1", gateway: gateway).generate }
      .to raise_error(described_class::NotDischargeSummary)
  end

  it "raises NotFound when the summary does not exist" do
    stub_batch(composition_body: nil)
    expect { described_class.new("c1", gateway: gateway).generate }.to raise_error(described_class::NotFound)
  end

  it "raises UpstreamError when a batch entry fails" do
    stub_batch(entries: [{ "response" => { "status" => "500" } }, batch_entry(searchset([]))])
    expect { described_class.new("c1", gateway: gateway).generate }.to raise_error(described_class::UpstreamError)
  end
end
