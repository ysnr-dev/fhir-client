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
    # 完了していないハブ(途中で中止・実施せず)は unfinished に返す。算定はしないが、
    # 「未実施」と混同しないよう理由つきで報告するため。
    class PerformedRecordCollector
      Record = Struct.new(:order_type, :hub, :children, :administrations, keyword_init: true) do
        def id = hub["id"]
        def status = hub["status"]
        def completed? = status == "completed"
        def order_id = Coding.reference_id(hub.dig("basedOn", 0, "reference"))
        def performed_at = hub["performedDateTime"] || hub.dig("performedPeriod", "start")
      end

      Collected = Struct.new(:records, :unfinished, :orphans, keyword_init: true)

      def initialize(store:)
        @store = store
      end

      def call(patient_fhir_id:, perform_date:)
        date = perform_date.to_s
        # 実施日時が「開始だけの期間」(注射など)のとき、date=<日付> の等価検索は上流で当たらない
        # (期間の終了が無いと等価にならない)。sa(前日より後に始まる)と le(その日までに始まる)を
        # 並べて「その日に始まった」で引く。会計の日付判定も開始の日なので、これと一致する。
        # status を絞るのは、日時を持たない計画中の Procedure(看護計画など)を除くため。
        resources = store.search("Procedure", {
                                   "subject" => "Patient/#{patient_fhir_id}",
                                   "date" => LocalDate.starts_on(date),
                                   "status" => "completed,stopped,not-done",
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
        # 種別が会計の対象でないもの(麻酔チャートなど)はここで外す。
        records.select! { |_, record| OrderCatalog.find(record.order_type) }

        # 親が検索結果のどこにも無いものだけを迷子として報告する。親が当日でない・会計の
        # 対象でない種別(麻酔チャートなど)のものは、その親ごと対象外なので黙って外す。
        known = procedures.to_h { |p| [p["id"], true] }
        orphans = []
        procedures.reject { |p| hub?(p) }.each do |child|
          attach(records, known, child, orphans) { |record| record.children << child }
        end
        administrations.each do |administration|
          attach(records, known, administration, orphans) { |record| record.administrations << administration }
        end

        completed, unfinished = records.values.partition(&:completed?)
        Collected.new(records: completed, unfinished: unfinished, orphans: orphans)
      end

      private

      attr_reader :store

      def hub?(procedure) = Array(procedure["partOf"]).empty?

      def performed_at(procedure)
        procedure["performedDateTime"] || procedure.dig("performedPeriod", "start")
      end

      def attach(records, known, resource, orphans)
        parents = Array(resource["partOf"]).filter_map { |ref| Coding.reference_id(ref["reference"]) }
        parent = parents.find { |id| records.key?(id) }
        if parent
          yield(records[parent])
        elsif parents.none? { |id| known.key?(id) }
          orphans << resource
        end
      end
    end
  end
end
