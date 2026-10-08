module Dpc
  # 入院期間に実施した手術・処置(点数表コード)と投与した薬剤を、上流の実施記録から集める。
  #
  #   Procedure(手技。code にレセ電算の診療行為コード)→ 診療行為マスタで点数表コード(K6722 など)
  #   MedicationAdministration(薬剤。レセ電算の医薬品コード)→ 医薬品マスタで剤形・YJ
  #   注射の手技が中心静脈(JAMI 31)→ G005
  #   放射線治療・リハビリの実施記録 → 「実施あり」の印(診療行為コードを持たないため)
  #
  # 手術の実施記録は入院(Encounter)を参照していないので、患者 + 入院期間の日付で引く。
  # 麻酔チャートの薬剤は算定と同じく数えない(全身麻酔は手術の実施記録の麻酔の手技で分かる)。
  # 手術の実施記録の薬剤は手術中の使用で、化学療法にも薬剤名の分岐にも数えない
  # (留意事項通知 第2の3(5)①、疑義解釈 問3-3-6・3-3-7)。手術の手技は数える。
  class PerformedItems
    Collected = Struct.new(:items, :radiotherapy, :rehab, :truncated, keyword_init: true)

    LOCAL = Integrations::ReceiptComputer::Coding::LOCAL
    ORDER_TYPE = Integrations::ReceiptComputer::Coding::ORDER_TYPE
    MEDICINE_CODE = Integrations::ReceiptComputer::Coding::MEDICINE_CODE
    METHOD = Integrations::ReceiptComputer::Coding::METHOD
    PROCEDURE_CODE_SYSTEM = %r{\A#{Regexp.escape(LOCAL)}/CodeSystem/[a-z-]+-procedure-code\z}
    CENTRAL_VENOUS_METHOD = "31".freeze
    CENTRAL_VENOUS_CODE = "G005".freeze
    EXCLUDED_ORDER_TYPES = %w[anesthesia-chart].freeze
    DRUG_EXCLUDED_ORDER_TYPES = %w[surgery].freeze
    LIMIT = 2000

    def initialize(store:)
      @store = store
    end

    def call(patient_fhir_id:, from:, to:)
      resources = store.search("Procedure", {
                                 "subject" => "Patient/#{patient_fhir_id}",
                                 "date" => ["ge#{from}", "le#{to}"],
                                 "status" => "completed",
                                 "_revinclude" => "Procedure:part-of",
                                 "_revinclude:iterate" => "MedicationAdministration:part-of",
                                 "_count" => "500"
                               }, limit: LIMIT)
      procedures = resources.select { |r| r["resourceType"] == "Procedure" }.uniq { |r| r["id"] }
      administrations = resources.select { |r| r["resourceType"] == "MedicationAdministration" }.uniq { |r| r["id"] }
      @by_id = procedures.index_by { |p| p["id"] }

      kept = procedures.select { |p| p["status"] == "completed" && !excluded?(p) }
      given = administrations.select do |a|
        a["status"] == "completed" && !excluded?(a) && !excluded?(a, DRUG_EXCLUDED_ORDER_TYPES)
      end
      types = kept.filter_map { |p| order_type(root(p)) }

      Collected.new(
        items: procedure_items(kept) + medicine_items(given) + central_venous_items(given),
        radiotherapy: types.include?("radiotherapy"),
        rehab: types.include?("rehab"),
        truncated: procedures.count { |p| Array(p["partOf"]).empty? } >= LIMIT
      )
    end

    private

    attr_reader :store

    def procedure_items(procedures)
      coded = procedures.flat_map do |procedure|
        Array(procedure.dig("code", "coding")).filter_map do |coding|
          next unless coding["system"].to_s.match?(PROCEDURE_CODE_SYSTEM) && coding["code"].present?

          [procedure, coding]
        end
      end
      masters = Master::MedicalProcedure.where(procedure_code: coded.map { |_, c| c["code"] }.uniq)
                                        .index_by(&:procedure_code)
      coded.filter_map do |procedure, coding|
        master = masters[coding["code"]]
        code = master&.k_code
        next if code.blank?

        Item.new(code: code, name: master.name || coding["display"], date: local_date(performed_at(procedure)),
                 source: "performed", ref: "Procedure/#{procedure['id']}")
      end
    end

    def medicine_items(administrations)
      codes = administrations.filter_map { |a| medicine_code(a) }.uniq
      masters = Master::Medicine.where(medicine_code: codes).index_by(&:medicine_code)
      administrations.filter_map do |administration|
        master = masters[medicine_code(administration)]
        next if master.nil?

        medicine = Medicine.new(code: master.medicine_code, name: master.name,
                                generic_name: master.generic_name_description, basic_name: master.basic_name,
                                dosage_form: master.dosage_form, yj_code: master.yakka_code)
        Item.new(code: nil, name: master.name, date: local_date(effective_at(administration)), source: "performed",
                 ref: "MedicationAdministration/#{administration['id']}", medicine: medicine)
      end
    end

    def central_venous_items(administrations)
      administrations.filter_map do |administration|
        method = Integrations::ReceiptComputer::Coding.code_of(administration.dig("dosage", "method"), METHOD)
        next unless method == CENTRAL_VENOUS_METHOD

        Item.new(code: CENTRAL_VENOUS_CODE, name: "中心静脈注射", date: local_date(effective_at(administration)),
                 source: "performed", ref: "MedicationAdministration/#{administration['id']}")
      end
    end

    def medicine_code(administration)
      Integrations::ReceiptComputer::Coding.code_of(administration["medicationCodeableConcept"], MEDICINE_CODE)
    end

    # partOf をたどった先のハブ(オーダー単位の Procedure)。
    def root(resource)
      seen = {}
      current = resource
      while (parent_id = Integrations::ReceiptComputer::Coding.reference_id(Array(current["partOf"]).first&.dig("reference")))
        break if seen[parent_id] || @by_id[parent_id].nil?

        seen[parent_id] = true
        current = @by_id[parent_id]
      end
      current
    end

    def order_type(procedure)
      Integrations::ReceiptComputer::Coding.code_in_list(procedure["category"], ORDER_TYPE)
    end

    def excluded?(resource, order_types = EXCLUDED_ORDER_TYPES)
      hub = root(resource)
      hub["resourceType"] == "Procedure" && order_types.include?(order_type(hub))
    end

    def performed_at(procedure)
      procedure["performedDateTime"] || procedure.dig("performedPeriod", "start")
    end

    def effective_at(administration)
      administration["effectiveDateTime"] || administration.dig("effectivePeriod", "start")
    end

    def local_date(value)
      Integrations::ReceiptComputer::LocalDate.of(value)
    end
  end
end
