require "rails_helper"

RSpec.describe Integrations::ReceiptComputer::PatientImporter do
  let(:system) { Integrations::ReceiptComputer::PatientResource::IDENTIFIER_SYSTEM }

  let(:store) do
    Class.new do
      attr_accessor :patients
      attr_reader :searches

      def initialize
        @patients = []
        @searches = []
      end

      def search(type, params, **)
        @searches << [type, params]
        patients
      end
    end.new
  end

  subject(:importer) { described_class.new(store: store) }

  def patient(number)
    { "resourceType" => "Patient", "id" => "pat-#{number}", "identifier" => [{ "system" => system, "value" => number }] }
  end

  it "looks up the 桁揃え違い candidates in one search" do
    importer.find("00002")

    expect(store.searches).to eq([["Patient", { "identifier" => "#{system}|00002,#{system}|2", "_count" => "10" }]])
  end

  it "prefers the patient carrying the レセコン's own number when both forms exist" do
    store.patients = [patient("2"), patient("00002")]

    expect(importer.find("00002")["id"]).to eq("pat-00002")
  end

  it "falls back to the number without leading zeros" do
    store.patients = [patient("2")]

    expect(importer.find("00002")["id"]).to eq("pat-2")
  end

  it "returns nil when no candidate matches" do
    expect(importer.find("00002")).to be_nil
  end
end
