require "rails_helper"

RSpec.describe Integrations::ReceiptComputer::CoverageImporter do
  let(:records) { Integrations::ReceiptComputer::Records }
  let(:system) { Integrations::ReceiptComputer::COVERAGE_IDENTIFIER_SYSTEM }

  # 検索は既存の Coverage を返し、transaction は送られた entry を記録する。
  let(:store) do
    Class.new do
      attr_accessor :existing
      attr_reader :searches, :transactions

      def initialize
        @existing = []
        @searches = []
        @transactions = []
      end

      def search(type, params, **)
        @searches << [type, params]
        existing
      end

      def transaction(entries)
        @transactions << entries
        {}
      end
    end.new
  end

  subject(:importer) { described_class.new(store: store) }

  def coverage(key:, kind: :insurance)
    records::CoverageRecord.new(external_key: key, kind: kind, type_code: "060", type_name: "国保",
                                insurer_number: "138057", insurer_name: "国保", relationship: "self",
                                period_start: "2026-04-01", copay_percent: 30)
  end

  def snapshot(*coverages)
    records::PatientSnapshot.new(patient: records::PatientRecord.new(number: "00002"),
                                 coverages: coverages, coverage_sets: [])
  end

  def existing(key, status: "active")
    { "resourceType" => "Coverage", "id" => "cov-#{key}", "status" => status,
      "identifier" => [{ "system" => system, "value" => "00002:#{key}" }] }
  end

  def import(*coverages) = importer.call(snapshot(*coverages), patient_fhir_id: "pat-1")

  it "writes every 保険 as a conditional update on its identifier, in one transaction" do
    counts = import(coverage(key: "ins-1"), coverage(key: "pub-1", kind: :public))

    expect(counts).to eq(imported: 2, cancelled: 0)
    expect(store.transactions.length).to eq(1)
    expect(store.transactions.first.map { |e| e["request"] }).to eq([
      { "method" => "PUT", "url" => "Coverage?identifier=#{CGI.escape("#{system}|00002:ins-1")}" },
      { "method" => "PUT", "url" => "Coverage?identifier=#{CGI.escape("#{system}|00002:pub-1")}" }
    ])
  end

  it "cancels the 保険 the レセコン no longer has, in the same transaction" do
    store.existing = [existing("ins-1"), existing("ins-old")]

    counts = import(coverage(key: "ins-1"))

    expect(counts).to eq(imported: 1, cancelled: 1)
    cancel = store.transactions.first.last
    expect(cancel["request"]).to eq("method" => "PUT", "url" => "Coverage/cov-ins-old")
    expect(cancel["resource"]["status"]).to eq("cancelled")
  end

  # 消す候補は上流で絞る(この連携の identifier を持ち、取消済みでないもの)。
  it "asks the 上流 only for live Coverage of this 連携" do
    import(coverage(key: "ins-1"))

    expect(store.searches).to eq([["Coverage", { "beneficiary" => "Patient/pat-1", "identifier" => "#{system}|",
                                                 "status:not" => "cancelled", "_count" => "100" }]])
  end

  it "sends nothing when there is nothing to write" do
    expect(import).to eq(imported: 0, cancelled: 0)
    expect(store.transactions).to be_empty
  end
end
