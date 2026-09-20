module Integrations
  module ReceiptComputer
    # レセコンの保険・公費をカルテ(上流 FHIR)の Coverage へ取り込む。
    #
    # レセコンが正本なので、取り込みは「今あるものを全部書く + 消えたものを
    # cancelled にする」という揃え方にする。差分を追わないので、通知を取りこぼした
    # あとに流しても必ず追いつく。
    class CoverageImporter
      def initialize(store: FhirStore.new)
        @store = store
      end

      # 返り値は { imported:, cancelled: } の件数。
      def call(snapshot, patient_fhir_id:)
        patient_number = snapshot.patient.number
        sets_by_key = sets_for(snapshot.coverage_sets)

        imported = snapshot.coverages.each_with_index.map do |record, index|
          resource = CoverageResource.build(
            record,
            patient_number: patient_number,
            patient_fhir_id: patient_fhir_id,
            sets: sets_by_key[record.external_key] || [],
            # 主保険を先に、公費をあとに並べる。
            order: record.kind == :insurance ? 1 : index + 2
          )
          store.conditional_put("Coverage", resource,
                                { "identifier" => CoverageResource.identifier_query(patient_number, record.external_key) })
        end

        { imported: imported.length, cancelled: cancel_missing(patient_fhir_id, patient_number, snapshot.coverages) }
      end

      private

      attr_reader :store

      # external_key → その保険が属する請求セット。
      def sets_for(sets)
        Array(sets).each_with_object(Hash.new { |h, k| h[k] = [] }) do |set, acc|
          Array(set.member_keys).each { |key| acc[key] << set }
        end
      end

      # レセコンから消えた保険は、カルテ側でも使えないようにする。
      # 記録としては残すので削除はしない。
      def cancel_missing(patient_fhir_id, patient_number, records)
        live = records.map { |r| CoverageResource.identifier_value(patient_number, r.external_key) }
        cancelled = 0

        existing_coverages(patient_fhir_id).each do |coverage|
          identifier = Array(coverage["identifier"])
                       .find { |i| i["system"] == ReceiptComputer::COVERAGE_IDENTIFIER_SYSTEM }
          next if identifier.nil?
          next if live.include?(identifier["value"])
          next if coverage["status"] == "cancelled"

          store.put("Coverage", coverage["id"], coverage.merge("status" => "cancelled"))
          cancelled += 1
        end

        cancelled
      end

      # 患者の Coverage を引いて、この連携が作ったものだけを見る。
      # identifier の system だけでの検索は上流が受けないので、患者で引いて絞る。
      def existing_coverages(patient_fhir_id)
        store.search("Coverage", { "beneficiary" => "Patient/#{patient_fhir_id}", "_count" => "100" })
      end
    end
  end
end
