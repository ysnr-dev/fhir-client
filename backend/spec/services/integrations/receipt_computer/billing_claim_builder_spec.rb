require "rails_helper"

RSpec.describe Integrations::ReceiptComputer::BillingClaimBuilder do
  let(:patient_id) { "pat-1" }
  let(:date) { "2026-09-20" }

  # 上流 FHIR の読み取りだけを差し替える。組み立ての正しさを見たいので HTTP は挟まない。
  let(:store) do
    Class.new do
      attr_accessor :medication_requests, :service_requests

      def initialize
        @medication_requests = []
        @service_requests = []
      end

      def search(type, _params, **)
        type == "MedicationRequest" ? medication_requests : service_requests
      end
    end.new
  end

  subject(:builder) { described_class.new(store: store) }

  def build = builder.call(patient_fhir_id: patient_id, perform_date: date)

  # 剤区分の割り当ては連携先ごとの話なので、日レセの電文に直したうえで確かめる。
  def orca_classes = Integrations::Orca::MedicalMessage.build(build.items).first

  def medication_request(code:, dose:, category: "1", rp: "1", days: nil, as_needed: false, name: "薬")
    timing_coding = [
      { "system" => "http://fhir-client.local/CodeSystem/medicine-usage", "code" => "1012040400000000" },
      { "system" => "http://fhir-client.local/CodeSystem/medicine-usage-basic-category", "code" => category }
    ]
    dosage = {
      "timing" => { "code" => { "coding" => timing_coding } },
      "doseAndRate" => [{ "doseQuantity" => { "value" => dose } }]
    }
    dosage["asNeededBoolean"] = true if as_needed

    request = {
      "resourceType" => "MedicationRequest", "status" => "active", "authoredOn" => date,
      "identifier" => [
        { "system" => "http://jpfhir.jp/fhir/core/mhlw/IdSystem/Medication-RPGroupNumber", "value" => rp }
      ],
      "medicationCodeableConcept" => {
        "text" => name,
        "coding" => [{ "system" => "http://fhir-client.local/CodeSystem/medicine-code", "code" => code }]
      },
      "dosageInstruction" => [dosage]
    }
    if days
      request["dispenseRequest"] = { "expectedSupplyDuration" => { "value" => days, "unit" => "日" } }
    end
    request
  end

  describe "処方" do
    it "groups a RP into one 剤 and carries the 用法コード and 投与日数" do
      store.medication_requests = [
        medication_request(code: "610406089", dose: 3, days: 7, name: "A錠"),
        medication_request(code: "620098801", dose: 1, days: 7, name: "B錠")
      ]

      items = build.items

      expect(items.length).to eq(1)
      expect(items.first.category).to eq(:oral)
      # 「回数」は内服では投与日数
      expect(items.first.days).to eq("7")
      expect(items.first.lines.map(&:code)).to eq(%w[610406089 620098801])
      expect(items.first.usage_code).to eq("1012040400000000")
    end

    it "splits separate RP numbers into separate 剤" do
      store.medication_requests = [
        medication_request(code: "1", dose: 1, rp: "1"),
        medication_request(code: "2", dose: 1, rp: "2")
      ]

      expect(build.items.length).to eq(2)
    end

    it "uses 頓服 for as-needed even though the 用法マスタ has no such category" do
      store.medication_requests = [medication_request(code: "1", dose: 1, as_needed: true)]

      expect(build.items.first.category).to eq(:as_needed)
      expect(orca_classes.first["Medical_Class"]).to eq("220")
    end

    it "uses 外用 for the topical category" do
      store.medication_requests = [medication_request(code: "1", dose: 1, category: "2")]

      expect(build.items.first.category).to eq(:topical)
      expect(orca_classes.first["Medical_Class"]).to eq("230")
    end

    it "reports 注射 as not sendable rather than dropping it silently" do
      store.medication_requests = [medication_request(code: "1", dose: 1, category: "3", name: "注射薬")]

      result = build

      expect(result.items).to be_empty
      expect(result.skipped.map(&:name)).to eq(["注射薬"])
    end

    it "reports 一般名処方 as not sendable with the reason" do
      request = medication_request(code: "1", dose: 1, name: "【般】ファモチジン")
      request["medicationCodeableConcept"]["coding"] = [
        { "system" => "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationGeneralOrderCode", "code" => "x" }
      ]
      store.medication_requests = [request]

      expect(build.skipped.first.reason).to include("一般名処方")
    end

    it "ignores prescriptions that were cancelled" do
      store.medication_requests = [medication_request(code: "1", dose: 1).merge("status" => "revoked")]

      expect(build.items).to be_empty
      expect(build.skipped).to be_empty
    end

    it "ignores prescriptions written on another day" do
      store.medication_requests = [medication_request(code: "1", dose: 1).merge("authoredOn" => "2026-09-19")]

      expect(build.items).to be_empty
    end

    it "writes whole-number doses without a decimal point" do
      store.medication_requests = [medication_request(code: "1", dose: 2.0)]

      expect(build.items.first.lines.first.quantity).to eq("2")
    end
  end

  describe "検査・処置などのオーダー" do
    def header(order_type:, id: "hdr-1")
      {
        "resourceType" => "ServiceRequest", "id" => id, "status" => "active", "authoredOn" => date,
        "category" => [
          { "coding" => [{ "system" => "http://fhir-client.local/CodeSystem/order-type", "code" => order_type }] }
        ],
        "code" => { "text" => "#{order_type}伝票" }
      }
    end

    def detail(item_code:, system:, parent: "hdr-1", name: "項目", id: nil)
      {
        "resourceType" => "ServiceRequest", "id" => id || "d-#{item_code}", "status" => "active",
        "authoredOn" => date,
        "code" => { "text" => name, "coding" => [{ "system" => system, "code" => item_code }] },
        "basedOn" => [{ "reference" => "ServiceRequest/#{parent}" }]
      }
    end

    let(:lab_system) { "http://fhir-client.local/CodeSystem/lab-order-item" }

    it "resolves 項目コード to レセ電算コード through the 項目マスタ" do
      Master::LabOrderItem.create!(order_item_code: "L1", name: "末梢血液一般", receipt_code: "160008010")
      store.service_requests = [
        header(order_type: "lab"),
        detail(item_code: "L1", system: lab_system, name: "末梢血液一般")
      ]

      items = build.items

      expect(items.length).to eq(1)
      expect(items.first.category).to eq(:lab)
      expect(items.first.lines.first.code).to eq("160008010")
      # 検体検査は「検査」の 600
      expect(orca_classes.first["Medical_Class"]).to eq("600")
    end

    it "reports items whose 項目マスタ has no レセ電算コード instead of dropping them" do
      Master::LabOrderItem.create!(order_item_code: "L2", name: "セット", receipt_code: nil)
      store.service_requests = [
        header(order_type: "lab"),
        detail(item_code: "L2", system: lab_system, name: "生化学セット")
      ]

      result = build

      expect(result.items).to be_empty
      expect(result.skipped.map(&:name)).to eq(["生化学セット"])
      expect(result.skipped.first.reason).to include("レセプト電算コード")
    end

    it "keeps the 剤 for the items that did resolve" do
      Master::LabOrderItem.create!(order_item_code: "L1", name: "ok", receipt_code: "160008010")
      Master::LabOrderItem.create!(order_item_code: "L2", name: "ng", receipt_code: nil)
      store.service_requests = [
        header(order_type: "lab"),
        detail(item_code: "L1", system: lab_system, name: "ok"),
        detail(item_code: "L2", system: lab_system, name: "ng")
      ]

      result = build

      expect(result.items.first.lines.length).to eq(1)
      expect(result.skipped.length).to eq(1)
    end

    it "maps 放射線 to 画像診断 and 処置/手術 to their own 区分" do
      Master::RadItem.create!(item_code: "R1", name: "胸部", receipt_code: "170000110")
      Master::TreatmentItem.create!(item_code: "T1", name: "処置", receipt_code: "140000110")
      store.service_requests = [
        header(order_type: "rad", id: "h-rad"),
        detail(item_code: "R1", system: "http://fhir-client.local/CodeSystem/rad-order-item", parent: "h-rad"),
        header(order_type: "treatment", id: "h-trt"),
        detail(item_code: "T1", system: "http://fhir-client.local/CodeSystem/treatment-order-item", parent: "h-trt")
      ]

      expect(build.items.map(&:category)).to contain_exactly(:rad, :treatment)
      expect(orca_classes.map { |c| c["Medical_Class"] }).to contain_exactly("700", "400")
    end

    it "does not complain about 処方 headers, which go through their own API" do
      store.service_requests = [
        header(order_type: "prescription"),
        detail(item_code: "X", system: lab_system)
      ]

      expect(build.skipped).to be_empty
    end

    it "reports order types that are not billed yet" do
      store.service_requests = [
        header(order_type: "nursing"),
        detail(item_code: "X", system: lab_system, name: "看護指示")
      ]

      expect(build.skipped.first.reason).to include("まだ医事会計へ送りません")
    end

    it "ignores a cancelled 伝票" do
      store.service_requests = [
        header(order_type: "lab").merge("status" => "revoked"),
        detail(item_code: "L1", system: lab_system)
      ]

      expect(build.items).to be_empty
      expect(build.skipped).to be_empty
    end
  end
end
