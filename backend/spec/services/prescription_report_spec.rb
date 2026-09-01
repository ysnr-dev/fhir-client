require "rails_helper"

# 上流アクセスは「オーダー read 1 本 + batch Bundle POST 1 本」であること、
# レイアウトの選択(院外だけ様式第2号)、RP のグルーピング、自院 Organization の
# フォールバック、失敗時の例外マッピングを検証する(PDF 描画は
# PrescriptionRenderer が担うのでモックする)。
RSpec.describe PrescriptionReport do
  let(:base_url) { "http://fhir.example" }
  let(:gateway) do
    FhirGateway.new(
      base_url: base_url, host_header: nil,
      token_provider: FhirTokenProvider.new(base_url: base_url, client_id: nil, client_secret: nil, host_header: nil)
    )
  end

  def build_order(setting: "outpatient", category: "external")
    {
      "resourceType" => "ServiceRequest",
      "id" => "o1",
      "category" => [
        { "coding" => [{ "system" => described_class::SETTING_SYSTEM, "code" => setting }] },
        { "coding" => [{ "system" => described_class::PRESCRIPTION_CATEGORY_SYSTEM, "code" => category }] }
      ],
      "subject" => { "reference" => "Patient/p1" },
      "authoredOn" => "2026-08-20T09:15:30+09:00",
      "occurrenceDateTime" => "2026-08-21"
    }
  end

  let(:order) { build_order }
  let(:patient) { { "resourceType" => "Patient", "id" => "p1" } }
  let(:institution) do
    {
      "resourceType" => "Organization",
      "id" => "org1",
      "name" => "テスト病院",
      "identifier" => [{ "system" => described_class::INSTITUTION_NO_SYSTEM, "value" => "1311234567" }]
    }
  end

  def medication_request(id, rp:, index:, name:, code: "610000001", generic: false, dose: 3, unit: "錠",
                         days: nil, count: nil, usage: "１日３回朝昼夕食後　服用", comment: nil)
    system = generic ? described_class::GENERAL_ORDER_CODE_SYSTEM : described_class::MEDICINE_CODE_SYSTEM
    dosage = {
      "timing" => {
        "code" => { "coding" => [{ "system" => described_class::USAGE_CODE_SYSTEM,
                                   "code" => "u1", "display" => usage }] }
      },
      "doseAndRate" => [{ "doseQuantity" => { "value" => dose, "unit" => unit } }]
    }
    dosage["timing"]["repeat"] = { "count" => count } if count
    dosage["additionalInstruction"] = [{ "text" => comment }] if comment
    resource = {
      "resourceType" => "MedicationRequest",
      "id" => id,
      "identifier" => [
        { "system" => described_class::RP_NUMBER_SYSTEM, "value" => rp.to_s },
        { "system" => described_class::ORDER_IN_RP_SYSTEM, "value" => index.to_s }
      ],
      "medicationCodeableConcept" => { "coding" => [{ "system" => system, "code" => code, "display" => name }] },
      "basedOn" => [{ "reference" => "ServiceRequest/o1" }]
    }
    resource["dispenseRequest"] = { "expectedSupplyDuration" => { "value" => days, "unit" => "日" } } if days
    resource["dosageInstruction"] = [dosage]
    resource
  end

  def batch_entry(resource)
    { "response" => { "status" => "200 OK" }, "resource" => resource }
  end

  def searchset(resources)
    { "resourceType" => "Bundle", "type" => "searchset",
      "entry" => resources.map { |r| { "resource" => r } } }
  end

  def stub_order(status: 200, body: order)
    stub_request(:get, "#{base_url}/ServiceRequest/o1")
      .to_return(status: status, body: body.to_json)
  end

  # batch の応答。明細検索は _revinclude なのでヘッダの ServiceRequest も混ざって返る。
  def stub_batch(medication_requests, organizations: [institution], entries: nil)
    stub_request(:post, "#{base_url}/")
      .to_return(status: 200, body: {
        "resourceType" => "Bundle", "type" => "batch-response",
        "entry" => entries || [
          batch_entry(searchset([order] + medication_requests)),
          batch_entry(patient),
          batch_entry(searchset(organizations))
        ]
      }.to_json)
  end

  def capture_renderer
    captured = nil
    allow(Reports::PrescriptionRenderer).to receive(:new) do |args|
      captured = args
      instance_double(Reports::PrescriptionRenderer, render: "%PDF")
    end
    -> { captured }
  end

  it "fetches details via _revinclude (based-on search is not supported upstream)" do
    stub_order
    batch = stub_batch([medication_request("m1", rp: 1, index: 1, name: "テスト錠", days: 7)])
    capture_renderer.call

    expect(described_class.new("o1", gateway: gateway).generate).to eq("%PDF")

    # MedicationRequest?based-on=... は上流に無い検索(未知パラメータは無視され
    # 全件が返る)。必ず _revinclude で取っていることを URL で固定する。
    expect(
      a_request(:post, "#{base_url}/") { |req|
        entries = JSON.parse(req.body)["entry"]
        urls = entries.map { |e| e.dig("request", "url") }
        urls[0] == "ServiceRequest?_id=o1&_revinclude=MedicationRequest%3Abased-on&_count=100" &&
          urls[1] == "Patient/p1" &&
          urls[2] == "Organization?identifier=#{CGI.escape(described_class::INSTITUTION_NO_SYSTEM)}%7C&_count=10"
      }
    ).to have_been_made.once
    expect(batch).to have_been_requested.once
  end

  it "selects the external layout only for outpatient external prescriptions" do
    {
      %w[outpatient external] => :external,
      %w[outpatient internal] => :internal,
      %w[inpatient regular] => :internal
    }.each do |(setting, category), expected|
      stub_order(body: build_order(setting: setting, category: category))
      stub_batch([medication_request("m1", rp: 1, index: 1, name: "テスト錠", days: 7)])
      captured = capture_renderer

      described_class.new("o1", gateway: gateway).generate

      layout = described_class::LAYOUTS.fetch(expected)
      expect(captured.call[:layout_path]).to eq(layout[:path])
      expect(captured.call[:lines_per_page]).to eq(layout[:lines_per_page])
    end
  end

  it "falls back to the internal layout when the category is missing" do
    stub_order(body: order.except("category"))
    stub_batch([medication_request("m1", rp: 1, index: 1, name: "テスト錠", days: 7)])
    captured = capture_renderer

    described_class.new("o1", gateway: gateway).generate

    expect(captured.call[:layout_path]).to eq(described_class::LAYOUTS.dig(:internal, :path))
  end

  it "groups medication requests by RP number in order" do
    stub_order
    stub_batch([
      medication_request("m3", rp: 2, index: 1, name: "頓服薬", count: 10, usage: "疼痛時"),
      medication_request("m2", rp: 1, index: 2, name: "ムコスタ錠", days: 7, comment: "胃保護"),
      medication_request("m1", rp: 1, index: 1, name: "【般】ファモチジン散２％", generic: true,
                                dose: 3, unit: "ｇ", days: 7)
    ])
    captured = capture_renderer

    described_class.new("o1", gateway: gateway).generate

    rps = captured.call[:rps]
    expect(rps.map(&:rp_number)).to eq([1, 2])
    # RP 内は RP 内番号順。一般名処方は一般名処方コードの display が名称になる。
    expect(rps[0].medicines.map(&:name)).to eq(["【般】ファモチジン散２％", "ムコスタ錠"])
    expect(rps[0].medicines[0].dose).to eq(3)
    expect(rps[0].medicines[0].unit).to eq("ｇ")
    expect(rps[0].dose_days).to eq(7)
    expect(rps[1].dose_count).to eq(10)
    expect(rps[1].usage_name).to eq("疼痛時")
  end

  it "continues with a nil organization when the institution search returns none" do
    stub_order
    stub_batch([medication_request("m1", rp: 1, index: 1, name: "テスト錠", days: 7)],
               organizations: [])
    captured = capture_renderer

    described_class.new("o1", gateway: gateway).generate

    expect(captured.call[:organization]).to be_nil
  end

  it "ignores organizations without the institution identifier (defense against match-all)" do
    stub_order
    # 未知の検索パラメータを無視する上流だと全 Organization が返り得る。
    # identifier を実際に持つものだけを自院として採用する。
    stub_batch([medication_request("m1", rp: 1, index: 1, name: "テスト錠", days: 7)],
               organizations: [{ "resourceType" => "Organization", "id" => "dept", "name" => "内科" },
                               institution])
    captured = capture_renderer

    described_class.new("o1", gateway: gateway).generate

    expect(captured.call[:organization]).to eq(institution)
  end

  describe "with a configured self organization" do
    # 自院が設定済みなら identifier 検索ではなく read で引く。連携先医療機関に
    # 保険医療機関番号を登録していても取り違えない。
    def stub_batch_with_read(organization_entry)
      stub_request(:post, "#{base_url}/")
        .to_return(status: 200, body: {
          "resourceType" => "Bundle", "type" => "batch-response",
          "entry" => [
            batch_entry(searchset([order, medication_request("m1", rp: 1, index: 1, name: "テスト錠", days: 7)])),
            batch_entry(patient),
            organization_entry
          ]
        }.to_json)
    end

    before { FacilitySettings.current.update!(self_organization_fhir_id: "org1") }

    it "reads the configured Organization instead of searching by identifier" do
      stub_order
      stub_batch_with_read(batch_entry(institution))
      captured = capture_renderer

      described_class.new("o1", gateway: gateway).generate

      expect(captured.call[:organization]).to eq(institution)
      expect(
        a_request(:post, "#{base_url}/") { |req|
          JSON.parse(req.body)["entry"].map { |e| e.dig("request", "url") }[2] == "Organization/org1"
        }
      ).to have_been_made.once
    end

    it "continues with a nil organization when the configured Organization is gone" do
      stub_order
      stub_batch_with_read({ "response" => { "status" => "404 Not Found" } })
      captured = capture_renderer

      described_class.new("o1", gateway: gateway).generate

      expect(captured.call[:organization]).to be_nil
    end
  end

  it "raises NotFound when the order does not exist" do
    stub_order(status: 404, body: {})

    expect { described_class.new("o1", gateway: gateway).generate }
      .to raise_error(described_class::NotFound)
  end

  it "raises NotPrescriptionOrder for orders with an order type (lab etc.)" do
    stub_order(body: order.merge(
      "category" => [{ "coding" => [{ "system" => described_class::ORDER_TYPE_SYSTEM, "code" => "lab" }] }]
    ))

    expect { described_class.new("o1", gateway: gateway).generate }
      .to raise_error(described_class::NotPrescriptionOrder)
  end

  it "raises NoMedication when the order has no medication requests" do
    stub_order
    stub_batch([])

    expect { described_class.new("o1", gateway: gateway).generate }
      .to raise_error(described_class::NoMedication)
  end

  it "raises UpstreamError when a batch entry fails" do
    stub_order
    stub_batch([], entries: [
      { "response" => { "status" => "500 Internal Server Error" } },
      batch_entry(patient),
      batch_entry(searchset([institution]))
    ])

    expect { described_class.new("o1", gateway: gateway).generate }
      .to raise_error(described_class::UpstreamError)
  end

  it "raises UpstreamError when the upstream returns an error for the order read" do
    stub_order(status: 500, body: {})

    expect { described_class.new("o1", gateway: gateway).generate }
      .to raise_error(described_class::UpstreamError)
  end
end
