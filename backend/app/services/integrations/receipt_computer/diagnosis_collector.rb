module Integrations
  module ReceiptComputer
    # その日に有効な保険病名を集めて中立の形で返す。
    #
    # 修飾語のコードはレセプト電算のまま渡し、連携先ごとの接頭辞はアダプタが付ける。
    class DiagnosisCollector
      include Records

      def initialize(store: FhirStore.new)
        @store = store
      end

      # プロブレム・既往歴(看護問題も problem-list-item を持つ)と、誤登録・否定された病名は上流で除く(:not は値の無い行を残すので、
      # category を持たない Condition も保険病名として扱う。カルテ側の conditionCategoryOf と同じ判定)。
      # 有効期間は onset / abatement の日付で見るので、ここで絞る。
      def call(patient_fhir_id:, perform_date:)
        date = perform_date.to_s
        store.search("Condition", {
                       "subject" => "Patient/#{patient_fhir_id}",
                       "category:not" => "problem-list-item,past-history",
                       "verification-status:not" => "entered-in-error,refuted",
                       "_count" => "500"
                     })
             .select { |c| active_on?(c, date) }
             .map { |c| build(c) }
      end

      private

      attr_reader :store

      def active_on?(condition, date)
        onset = condition["onsetDateTime"].to_s[0, 10]
        abatement = condition["abatementDateTime"].to_s[0, 10]
        return false if onset.present? && onset > date
        return false if abatement.present? && abatement < date

        true
      end

      def build(condition)
        code = condition["code"] || {}
        base = Coding.code_of(code, Coding::DISEASE_RECEIPT)
        prefixes = modifier_codes(code, Coding::PREFIX_MODIFIER_EXT)
        postfixes = modifier_codes(code, Coding::POSTFIX_MODIFIER_EXT)

        Diagnosis.new(
          name: code["text"].presence || Coding.display_of(code, Coding::DISEASE_RECEIPT),
          # 接頭語 → 病名 → 接尾語 の並びで一連病名を組み立てる。
          codes: base ? [base] : [],
          modifier_codes: { prefix: prefixes, postfix: postfixes },
          suspected: postfixes.include?("8002"),
          start_date: condition["onsetDateTime"].to_s[0, 10].presence,
          end_date: condition["abatementDateTime"].to_s[0, 10].presence,
          outcome: outcome_of(condition)
        )
      end

      # 継続は nil。軽快に当たる中立の語が無いので継続のままにする。
      def outcome_of(condition)
        case Array(condition.dig("clinicalStatus", "coding")).first&.dig("code")
        when "resolved" then :resolved
        when "inactive" then :inactive
        end
      end

      def modifier_codes(code, extension_url)
        Array(code["extension"]).select { |e| e["url"] == extension_url }.filter_map do |ext|
          Coding.code_of(ext["valueCodeableConcept"], Coding::MODIFIER_RECEIPT)
        end
      end
    end
  end
end
