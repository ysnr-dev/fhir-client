module Integrations
  module ReceiptComputer
    # レセコンの患者基本情報をカルテ(上流 FHIR)へ取り込む。
    #
    # 患者番号の identifier で条件付き更新するので、何度流しても同じ結果になる。
    # 同じ番号の患者がカルテ側に先にあれば、そこへ合流する。
    class PatientImporter
      def initialize(store: FhirStore.new)
        @store = store
      end

      # 取り込んだ Patient(FHIR リソース)を返す。
      def call(record)
        existing = find(record.number)
        resource = PatientResource.build(record, existing: existing)
        # 条件は実際に書き込む番号で立てる。桁揃えが違う患者を拾ったときに
        # レセコン側の番号で条件を立てると、同じ患者をもう 1 人作ってしまう。
        number = PatientResource.number_of(resource)
        store.conditional_put("Patient", resource,
                              { "identifier" => PatientResource.identifier_query(number) })
      end

      # レセコンで削除された患者。カルテの記録は残すので active を下ろすだけにする。
      def deactivate(patient_number)
        existing = find(patient_number)
        return nil if existing.nil?

        store.put("Patient", existing["id"], PatientResource.deactivate(existing))
      end

      # 桁揃え違いも同じ患者として拾う(レセコンは "00002"、カルテは "2" のことがある)。
      def find(patient_number)
        PatientResource.candidate_numbers(patient_number).each do |candidate|
          found = store.search("Patient",
                               { "identifier" => PatientResource.identifier_query(candidate), "_count" => "2" },
                               limit: 2).first
          return found if found
        end
        nil
      end

      private

      attr_reader :store
    end
  end
end
