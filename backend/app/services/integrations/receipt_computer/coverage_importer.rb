module Integrations
  module ReceiptComputer
    # レセコンの保険・公費をカルテ(上流 FHIR)の Coverage へ取り込む。
    #
    # レセコンが正本なので、取り込みは「今あるものを全部書く + 消えたものを
    # cancelled にする」という揃え方にする。差分を追わないので、通知を取りこぼした
    # あとに流しても必ず追いつく。
    #
    # 上流には検索 1 回と transaction Bundle 1 回。書き込みは全部まとめて送るので、
    # 途中で失敗しても半端に取り込まれた状態にならない。
    class CoverageImporter
      def initialize(store: FhirStore.new)
        @store = store
      end

      # 返り値は { imported:, cancelled: } の件数。
      def call(snapshot, patient_fhir_id:)
        patient_number = snapshot.patient.number
        sets_by_key = sets_for(snapshot.coverage_sets)

        imports = snapshot.coverages.each_with_index.map do |record, index|
          resource = CoverageResource.build(
            record,
            patient_number: patient_number,
            patient_fhir_id: patient_fhir_id,
            sets: sets_by_key[record.external_key] || [],
            # 主保険を先に、公費をあとに並べる。
            order: record.kind == :insurance ? 1 : index + 2
          )
          conditional_update(resource, CoverageResource.identifier_query(patient_number, record.external_key))
        end
        cancels = missing_coverages(patient_fhir_id, patient_number, snapshot.coverages).map do |coverage|
          update(coverage.merge("status" => "cancelled"))
        end

        store.transaction(imports + cancels) if (imports + cancels).any?
        { imported: imports.length, cancelled: cancels.length }
      end

      private

      attr_reader :store

      def conditional_update(resource, criteria)
        { "resource" => resource,
          "request" => { "method" => "PUT", "url" => "Coverage?identifier=#{CGI.escape(criteria)}" } }
      end

      def update(resource)
        { "resource" => resource, "request" => { "method" => "PUT", "url" => "Coverage/#{resource['id']}" } }
      end

      # external_key → その保険が属する請求セット。
      def sets_for(sets)
        Array(sets).each_with_object(Hash.new { |h, k| h[k] = [] }) do |set, acc|
          Array(set.member_keys).each { |key| acc[key] << set }
        end
      end

      # レセコンから消えた保険は、カルテ側でも使えないようにする。
      # 記録としては残すので削除はしない。
      def missing_coverages(patient_fhir_id, patient_number, records)
        live = records.map { |r| CoverageResource.identifier_value(patient_number, r.external_key) }

        existing_coverages(patient_fhir_id).reject do |coverage|
          identifier = Array(coverage["identifier"])
                       .find { |i| i["system"] == ReceiptComputer::COVERAGE_IDENTIFIER_SYSTEM }
          identifier.nil? || live.include?(identifier["value"])
        end
      end

      # 患者の Coverage のうち、この連携が作ったもの(identifier の体系)で取り消していないもの。
      def existing_coverages(patient_fhir_id)
        store.search("Coverage", {
                       "beneficiary" => "Patient/#{patient_fhir_id}",
                       "identifier" => "#{ReceiptComputer::COVERAGE_IDENTIFIER_SYSTEM}|",
                       "status:not" => "cancelled",
                       "_count" => "100"
                     })
      end
    end
  end
end
