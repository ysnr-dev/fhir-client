require "rails_helper"

# 上流アクセスが「オーダー read 1 本 + batch Bundle POST 1 本」であること、注射以外を
# 弾くこと、RP のグルーピング(用法・開始時刻)、失敗時の例外マッピングを検証する
# (PDF 描画はレンダラが担うのでモックする)。
RSpec.describe InjectionReport do
  let(:base_url) { "http://fhir.example" }
  let(:gateway) do
    FhirGateway.new(
      base_url: base_url, host_header: nil,
      token_provider: FhirTokenProvider.new(base_url: base_url, client_id: nil, client_secret: nil, host_header: nil)
    )
  end

  let(:order) do
    {
      "resourceType" => "ServiceRequest", "id" => "o1",
      "category" => [
        { "coding" => [{ "system" => described_class::ORDER_TYPE_SYSTEM, "code" => "injection" }] },
        { "coding" => [{ "system" => described_class::SETTING_SYSTEM, "code" => "inpatient", "display" => "入院" }] },
        { "coding" => [{ "system" => described_class::INJECTION_CATEGORY_SYSTEM, "code" => "regular", "display" => "定時" }] }
      ],
      "subject" => { "reference" => "Patient/p1" },
      "authoredOn" => "2026-08-30"
    }
  end
  let(:patient) { { "resourceType" => "Patient", "id" => "p1" } }
  let(:institution) do
    { "resourceType" => "Organization", "id" => "org1", "name" => "テスト病院",
      "identifier" => [{ "system" => described_class::INSTITUTION_NO_SYSTEM, "value" => "1311234567" }] }
  end

  def medication_request(id, rp:, index:, name:, dose: 1, unit: "袋", route: "静脈内", usage_type: "点滴",
                         rate: nil, times: [], comment: nil)
    dosage = {
      "extension" => [{ "url" => described_class::USAGE_TYPE_EXT_URL,
                        "valueCodeableConcept" => { "coding" => [{ "code" => "drip", "display" => usage_type }] } }],
      "route" => { "coding" => [{ "code" => "IV", "display" => route }] },
      "doseAndRate" => [{ "doseQuantity" => { "value" => dose, "unit" => unit } }]
    }
    dosage["doseAndRate"][0]["rateQuantity"] = { "value" => rate, "unit" => "mL/h" } if rate
    dosage["timing"] = { "event" => times.map { |t| "2026-08-30T#{t}:00+09:00" } } if times.any?
    dosage["additionalInstruction"] = [{ "text" => comment }] if comment
    {
      "resourceType" => "MedicationRequest", "id" => id,
      "identifier" => [
        { "system" => described_class::RP_NUMBER_SYSTEM, "value" => rp.to_s },
        { "system" => described_class::ORDER_IN_RP_SYSTEM, "value" => index.to_s }
      ],
      "medicationCodeableConcept" => { "coding" => [{ "system" => described_class::MEDICINE_CODE_SYSTEM,
                                                        "code" => "620000001", "display" => name }] },
      "basedOn" => [{ "reference" => "ServiceRequest/o1" }],
      "dosageInstruction" => [dosage]
    }
  end

  def batch_entry(resource) = { "response" => { "status" => "200 OK" }, "resource" => resource }
  def searchset(resources)
    { "resourceType" => "Bundle", "type" => "searchset", "entry" => resources.map { |r| { "resource" => r } } }
  end

  def stub_order(status: 200, body: order)
    stub_request(:get, "#{base_url}/ServiceRequest/o1").to_return(status: status, body: body.to_json)
  end

  def stub_batch(medication_requests, entries: nil)
    stub_request(:post, "#{base_url}/").to_return(status: 200, body: {
      "resourceType" => "Bundle", "type" => "batch-response",
      "entry" => entries || [batch_entry(searchset([order] + medication_requests)),
                             batch_entry(patient), batch_entry(searchset([institution]))]
    }.to_json)
  end

  def capture(renderer_class)
    captured = nil
    allow(renderer_class).to receive(:new) do |args|
      captured = args
      instance_double(renderer_class, render: "%PDF")
    end
    -> { captured }
  end

  it "fetches details via _revinclude and renders the order sheet" do
    stub_order
    stub_batch([medication_request("m1", rp: 1, index: 1, name: "生理食塩液")])
    captured = capture(Reports::InjectionRenderer)

    expect(described_class.new("o1", gateway: gateway).generate_order).to eq("%PDF")
    expect(captured.call[:layout_path]).to eq(described_class::ORDER_LAYOUT[:path])
    expect(
      a_request(:post, "#{base_url}/") { |req|
        urls = JSON.parse(req.body)["entry"].map { |e| e.dig("request", "url") }
        urls[0] == "ServiceRequest?_id=o1&_revinclude=MedicationRequest%3Abased-on&_count=100" &&
          urls[1] == "Patient/p1"
      }
    ).to have_been_made.once
  end

  it "groups medication requests by RP with usage and start times" do
    stub_order
    stub_batch([
      medication_request("m3", rp: 2, index: 1, name: "セファゾリン", usage_type: "ワンショット", times: ["20:30"]),
      # 投与速度は frontend が RP 内の全薬剤に同じ値を写す。グループの用法は最初に
      # 現れた明細から取るので、順不同で届いても同じ値になる。
      medication_request("m2", rp: 1, index: 2, name: "KCL", rate: 100, times: %w[10:00 20:30],
                                comment: "ゆっくり"),
      medication_request("m1", rp: 1, index: 1, name: "生理食塩液", rate: 100, times: %w[10:00 20:30])
    ])
    captured = capture(Reports::InjectionLabelRenderer)

    described_class.new("o1", gateway: gateway).generate_labels

    rps = captured.call[:rps]
    expect(rps.map(&:rp_number)).to eq([1, 2])
    expect(rps[0].medicines.map(&:name)).to eq(%w[生理食塩液 KCL])
    expect(rps[0].usage_type).to eq("点滴")
    expect(rps[0].route).to eq("静脈内")
    expect(rps[0].rate).to eq(100)
    expect(rps[0].start_times).to eq(%w[10:00 20:30])
    expect(rps[1].usage_type).to eq("ワンショット")
    expect(rps[1].start_times).to eq(["20:30"])
  end

  it "raises NotInjectionOrder for prescriptions (no order type)" do
    stub_order(body: order.except("category"))
    expect { described_class.new("o1", gateway: gateway).generate_order }
      .to raise_error(described_class::NotInjectionOrder)
  end

  it "raises NotFound when the order does not exist" do
    stub_order(status: 404, body: {})
    expect { described_class.new("o1", gateway: gateway).generate_order }
      .to raise_error(described_class::NotFound)
  end

  it "raises NoMedication when the order has no medication requests" do
    stub_order
    stub_batch([])
    expect { described_class.new("o1", gateway: gateway).generate_order }
      .to raise_error(described_class::NoMedication)
  end

  it "raises UpstreamError when a batch entry fails" do
    stub_order
    stub_batch([], entries: [{ "response" => { "status" => "500" } }, batch_entry(patient),
                             batch_entry(searchset([institution]))])
    expect { described_class.new("o1", gateway: gateway).generate_order }
      .to raise_error(described_class::UpstreamError)
  end
end
