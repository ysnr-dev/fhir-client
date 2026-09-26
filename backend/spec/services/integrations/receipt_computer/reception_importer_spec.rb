require "rails_helper"

RSpec.describe Integrations::ReceiptComputer::ReceptionImporter do
  # 種別ごとに検索結果を差し替える。search は [種別, 条件] を記録する。
  let(:store) do
    Class.new do
      attr_reader :written, :searches
      attr_accessor :results

      def initialize
        @results = {}
        @searches = []
      end

      def search(type, params, **)
        @searches << [type, params]
        results.fetch(type, [])
      end

      def read_or_nil(_type, _id) = nil
      def conditional_put(_type, resource, _query) = @written = resource
      def put(_type, _id, resource) = @written = resource
    end.new
  end

  let(:mapper) do
    Class.new do
      def to_local(_kind, _code) = nil
    end.new
  end

  subject(:importer) { described_class.new(store: store, mapper: mapper) }

  def event(coverage_set_key: nil, action: :created)
    Integrations::ReceiptComputer::Records::ReceptionEvent.new(
      event_id: "e1", action: action, reception_key: "r1", patient_number: "00021",
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

  describe "取消" do
    let(:appointment) { { "resourceType" => "Appointment", "id" => "ap-1", "status" => "checked-in" } }

    before { store.results["Appointment"] = [appointment] }

    it "診察が始まっていなければ受付を取り消す" do
      importer.call(event(action: :canceled), patient_fhir_id: "p1")

      expect(store.written["status"]).to eq "cancelled"
    end

    # 診察の有無は Encounter を予約(appointment)で引いて決める。1 件あれば足りる。
    it "予約を指す Encounter があれば取り消さない" do
      store.results["Encounter"] = [{ "resourceType" => "Encounter", "id" => "enc-1" }]

      importer.call(event(action: :canceled), patient_fhir_id: "p1")

      expect(store.written).to be_nil
      expect(store.searches).to include(["Encounter", { "appointment" => "Appointment/ap-1", "_count" => "1" }])
    end
  end
end
