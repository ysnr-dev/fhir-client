require "rails_helper"
require "support/billing_fhir_fixtures"

RSpec.describe Integrations::ReceiptComputer::BillingSender do
  let(:records) { Integrations::ReceiptComputer::Records }
  let(:date) { "2026-09-20" }
  let(:store) do
    BillingFhirFixtures::FakeStore.new.add(
      { "resourceType" => "Patient", "id" => "pat-1",
        "identifier" => [{ "system" => "http://fhir-client.local/IdSystem/patient-number", "value" => "00002" }] }
    )
  end

  # 受けた会計を覚えるだけのレセコン。
  let(:adapter) do
    Class.new do
      attr_reader :claims, :result

      def initialize(result)
        @claims = []
        @result = result
      end

      def system_type = "orca"
      def code_kinds = Integrations::Orca::Adapter::CODE_KINDS

      def describe_billing(items) = Integrations::Orca::Adapter.allocate.describe_billing(items)

      def send_billing(claim)
        @claims << claim
        result
      end

      def send_diagnoses(**) = nil
    end.new(records::Result.new(outcome: :succeeded, code: "00", message: "処理終了"))
  end

  let(:log) { instance_double(Integrations::EventLog, write: nil) }

  subject(:sender) { described_class.new(adapter: adapter, store: store, log: log) }

  before do
    allow(Integrations::ReceiptComputer::PatientResource).to receive(:number_of).and_return("00002")
    Master::TreatmentItem.create!(item_code: "T1", name: "創傷処置", receipt_code: "140000110")
    medical_procedure!("140000110", name: "創傷処置", chapter: "J", section: "000")
    store.add(order_header(order_type: "treatment"),
              procedure_hub(order_type: "treatment", code: "140000110", name: "創傷処置",
                            materials: [{ code: "700010000", name: "ガーゼ", quantity: 3 }]))
  end

  describe "#preview" do
    it "shows the 剤 the way the レセコン will receive them, with the 区分 name" do
      preview = sender.preview(patient_fhir_id: "pat-1", perform_date: date)

      item = preview[:items].first
      expect(item[:class_code]).to eq("400")
      expect(item[:class_name]).to eq("処置")
      expect(item[:name]).to eq("処置")
      expect(item[:performed_at]).to eq("2026-09-20T10:30:00+09:00")
      expect(item[:lines].map { |l| l[:kind] }).to eq(%w[procedure material])
      expect(item[:lines].last).to include(code: "700010000", quantity: "3", unit: "個")
      expect(preview[:diagnoses]).to eq([])
      expect(preview[:skipped]).to eq([])
    end

    it "lists what the 連携先 cannot place, next to what the builder skipped" do
      medical_procedure!("111000110", name: "初診料", chapter: "A", section: "000")
      store.add(child_procedure(order_type: "treatment", code: "111000110", name: "初診料"))

      preview = sender.preview(patient_fhir_id: "pat-1", perform_date: date)

      expect(preview[:skipped].map { |s| s[:name] }).to eq(["初診料"])
    end

    it "still previews without 区分 names when no レセコン is configured" do
      sender = described_class.new(adapter: nil, store: store, log: log)
      allow(Integrations::ReceiptComputer).to receive(:adapter!)
        .and_raise(Integrations::ReceiptComputer::NotConfigured, "未設定")

      preview = sender.preview(patient_fhir_id: "pat-1", perform_date: date)

      expect(preview[:items].first[:class_code]).to be_nil
      expect(preview[:items].first[:lines].length).to eq(2)
    end
  end

  describe "#call" do
    it "sends the built 剤 and records the outcome" do
      allow(Integrations::CodeMapper).to receive(:new)
        .and_return(instance_double(Integrations::CodeMapper, to_external: "01"))

      result = sender.call(patient_fhir_id: "pat-1", perform_date: date, department_code: "01",
                           coverage_set_key: "0001", requested_by: "u1")

      claim = adapter.claims.first
      expect(claim.patient_number).to eq("00002")
      expect(claim.items.first.lines.map(&:kind)).to eq(%i[procedure material])
      expect(claim.auto_basic_fee).to be(true)
      expect(result[:billing].outcome).to eq(:succeeded)
      expect(log).to have_received(:write).with(hash_including(action: "billing.send", outcome: :succeeded))
    end

    it "passes the 診察開始時刻 of the day's 外来 Encounter as the 診療時刻" do
      allow(Integrations::CodeMapper).to receive(:new)
        .and_return(instance_double(Integrations::CodeMapper, to_external: "01"))
      store.add({ "resourceType" => "Encounter", "id" => "enc-1", "status" => "finished",
                  "class" => { "code" => "AMB" }, "subject" => { "reference" => "Patient/pat-1" },
                  "period" => { "start" => "2026-09-20T19:45:00+09:00", "end" => "2026-09-20T20:10:00+09:00" } },
                { "resourceType" => "Encounter", "id" => "enc-old", "status" => "finished",
                  "class" => { "code" => "AMB" }, "subject" => { "reference" => "Patient/pat-1" },
                  "period" => { "start" => "2026-09-19T09:00:00+09:00" } })

      sender.call(patient_fhir_id: "pat-1", perform_date: date, department_code: "01")

      expect(adapter.claims.first.time).to eq("19:45")
    end

    it "leaves the 診療時刻 empty when the day has no 外来 Encounter" do
      allow(Integrations::CodeMapper).to receive(:new)
        .and_return(instance_double(Integrations::CodeMapper, to_external: "01"))

      sender.call(patient_fhir_id: "pat-1", perform_date: date, department_code: "01")

      expect(adapter.claims.first.time).to be_nil
    end

    it "downgrades success to a warning when something could not be sent" do
      allow(Integrations::CodeMapper).to receive(:new)
        .and_return(instance_double(Integrations::CodeMapper, to_external: "01"))
      store.add(order_header(order_type: "transfusion", id: "r-1", name: "輸血"))

      result = sender.call(patient_fhir_id: "pat-1", perform_date: date, department_code: "01")

      expect(result[:billing].outcome).to eq(:warning)
      expect(result[:billing].skipped.first[:reason]).to include("まだ医事会計へ送りません")
    end
  end
end
