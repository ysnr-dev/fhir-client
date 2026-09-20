require "rails_helper"

RSpec.describe Integrations::ReceiptComputer::ReceptionImporter do
  let(:store) do
    Class.new do
      attr_reader :written

      def search(_type, _params, **) = []
      def read_or_nil(_type, _id) = nil
      def conditional_put(_type, resource, _query) = @written = resource
    end.new
  end

  let(:mapper) do
    Class.new do
      def to_local(_kind, _code) = nil
    end.new
  end

  subject(:importer) { described_class.new(store: store, mapper: mapper) }

  def event(coverage_set_key:)
    Integrations::ReceiptComputer::Records::ReceptionEvent.new(
      event_id: "e1", action: :created, reception_key: "r1", patient_number: "00021",
      date: "2026-09-20", time: "19:30:00", coverage_set_key: coverage_set_key
    )
  end

  def coverage_set_of(resource)
    Array(resource["extension"])
      .find { |e| e["url"] == Integrations::ReceiptComputer::RECEPTION_COVERAGE_SET_URL }
      &.dig("valueString")
  end

  it "受付の請求セットを Appointment に記録する" do
    importer.call(event(coverage_set_key: "0001"), patient_fhir_id: "p1")

    expect(coverage_set_of(store.written)).to eq "0001"
  end

  # 全ゼロは「保険を選ばずに受付した」ことを表す番号で、実在する組合せではない。
  # 記録すると会計送信がその番号をレセコンへ返してしまう。
  it "「未選択」を表す全ゼロの請求セットは記録しない" do
    importer.call(event(coverage_set_key: "0000"), patient_fhir_id: "p1")

    expect(coverage_set_of(store.written)).to be_nil
  end
end
