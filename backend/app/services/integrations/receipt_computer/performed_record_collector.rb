module Integrations
  module ReceiptComputer
    # 患者 + 診療日の実施記録を、ハブ(オーダー単位の Procedure)ごとに束ねて返す。
    #
    #   Procedure(ハブ。partOf 無し、category = order-type、basedOn = オーダー)
    #    ├ partOf ← Procedure               (2 件目以降の手技)
    #    └ partOf ← MedicationAdministration (薬剤)
    #
    # 上流には 1 往復。ハブと子は同じ日付で検索に当たり、薬剤は _revinclude で付いてくる。
    # 帰属先のハブが無い子・薬剤は捨てず orphans に返す(取消の途中で残ったものなど)。
    class PerformedRecordCollector
      Record = Struct.new(:order_type, :hub, :children, :administrations, keyword_init: true) do
        def id = hub["id"]
        def order_id = Coding.reference_id(hub.dig("basedOn", 0, "reference"))
        def performed_at = hub["performedDateTime"] || hub.dig("performedPeriod", "start")
      end

      Collected = Struct.new(:records, :orphans, keyword_init: true)

      def initialize(store:)
        @store = store
      end

      def call(patient_fhir_id:, perform_date:)
        date = perform_date.to_s
        resources = store.search("Procedure", {
                                   "subject" => "Patient/#{patient_fhir_id}",
                                   "date" => date,
                                   "status" => "completed",
                                   "_revinclude" => "Procedure:part-of",
                                   "_revinclude:iterate" => "MedicationAdministration:part-of",
                                   "_count" => "500"
                                 })

        procedures = resources.select { |r| r["resourceType"] == "Procedure" }.uniq { |r| r["id"] }
        administrations = resources.select { |r| r["resourceType"] == "MedicationAdministration" }
                                   .uniq { |r| r["id"] }

        hubs = procedures.select { |p| hub?(p) && LocalDate.of(performed_at(p)) == date }
        records = hubs.to_h do |hub|
          [hub["id"], Record.new(order_type: Coding.code_in_list(hub["category"], Coding::ORDER_TYPE),
                                 hub: hub, children: [], administrations: [])]
        end

        orphans = []
        procedures.reject { |p| hub?(p) }.each do |child|
          attach(records, child, orphans) { |record| record.children << child }
        end
        administrations.each do |administration|
          attach(records, administration, orphans) { |record| record.administrations << administration }
        end

        Collected.new(records: records.values, orphans: orphans)
      end

      private

      attr_reader :store

      def hub?(procedure) = Array(procedure["partOf"]).empty?

      def performed_at(procedure)
        procedure["performedDateTime"] || procedure.dig("performedPeriod", "start")
      end

      def attach(records, resource, orphans)
        parent = Array(resource["partOf"]).filter_map { |ref| Coding.reference_id(ref["reference"]) }
                                          .find { |id| records.key?(id) }
        parent ? yield(records[parent]) : orphans << resource
      end
    end
  end
end
