module Integrations
  module ReceiptComputer
    # 実施記録(PerformedRecordCollector::Record)→ 会計の 1 剤。
    #
    # 行の並びは 手技(ハブの code → 子の code)→ 薬剤 → 材料 → コメント。手技の区分番号
    # (点数表の章)は後で ProcedureSections が一括で載せる。コードを引けない行は
    # 黙って消さず skipped に積む。
    class PerformedItemBuilder
      include Records

      # フリーコメントのレセ電算コード。実施コメントはこれで送る。
      FREE_COMMENT_CODE = "810000001".freeze

      # medication_requests は当日のオーダーの MedicationRequest(id → リソース)。注射の
      # 用法種別(点滴 / ワンショット)は実施記録に写されずオーダー側にしか無いので、
      # MedicationAdministration.request から引く。連日の注射は実施日と別の日のオーダーを
      # 指すことがあり、当日の集合に無ければ上流から読む。
      def initialize(skipped, medication_requests: {}, store: nil)
        @skipped = skipped
        @medication_requests = medication_requests
        @store = store
      end

      # records は同じ診療日のもの。放射線の器材と手技の区分番号は種別をまたいで
      # 一括で引くので、剤を全部組んでから埋める。
      def call(records)
        rad_materials = rad_material_codes(records)
        items = records.filter_map { |record| build(record, rad_materials) }
        fill_sections(items)
        items
      end

      private

      attr_reader :skipped, :medication_requests, :store

      def build(record, rad_materials)
        definition = OrderCatalog.find(record.order_type)
        return nil if definition.nil?

        lines = (definition.coded_hub? ? procedure_lines(record, definition) : []) +
                medicine_lines(record, definition) +
                material_lines(record, definition, rad_materials) +
                comment_lines(record)
        return nil if lines.empty?

        item = BillingItem.new(category: definition.order_type.to_sym, name: definition.label, lines: lines,
                               performed_at: record.performed_at, source_ref: "Procedure/#{record.id}")
        fill_injection(item, record) unless definition.coded_hub?
        item
      end

      # 注射の剤区分(皮下筋注 / 静注 / 点滴 / 中心静脈 …)は連携先が決める。その材料になる
      # 投与経路・手技・用法種別を 1 施用(ハブ)の最初の薬剤から写す。1 施用は同じ経路で行う。
      def fill_injection(item, record)
        administration = record.administrations.first
        return if administration.nil?

        dosage = administration["dosage"] || {}
        item.route = Coding.code_of(dosage["route"], Coding::ROUTE)
        item.method = Coding.code_of(dosage["method"], Coding::METHOD)

        request = medication_request(Coding.reference_id(administration.dig("request", "reference")))
        instruction = request&.dig("dosageInstruction", 0) || {}
        usage = Array(instruction["extension"]).find { |e| e["url"] == Coding::INJECTION_USAGE_TYPE_EXT }
        item.usage_type = Coding.code_of(usage&.dig("valueCodeableConcept"), Coding::INJECTION_USAGE_TYPE)
        item.route ||= Coding.code_of(instruction["route"], Coding::ROUTE)
        item.method ||= Coding.code_of(instruction["method"], Coding::METHOD)
      end

      def medication_request(id)
        return nil if id.blank?
        return medication_requests[id] if medication_requests.key?(id)

        medication_requests[id] = store&.read_or_nil("MedicationRequest", id)
      end

      def procedure_lines(record, definition)
        [record.hub, *record.children].filter_map do |procedure|
          concept = procedure["code"]
          next nil if concept.nil?

          code = Coding.code_of(concept, definition.procedure_code_system)
          name = Coding.label_of(concept, definition.procedure_code_system)
          if code.blank?
            skipped << BillingClaimBuilder::Skipped.new(kind: definition.label, name: name,
                                                       reason: "実施記録の手技に診療行為コードがありません")
            next nil
          end

          BillingLine.new(code: code, name: name, quantity: "1", kind: :procedure)
        end
      end

      def medicine_lines(record, definition)
        record.administrations.filter_map do |administration|
          concept = administration["medicationCodeableConcept"]
          code = Coding.code_of(concept, Coding::MEDICINE_CODE)
          name = Coding.label_of(concept, Coding::MEDICINE_CODE)
          if code.blank?
            skipped << BillingClaimBuilder::Skipped.new(kind: definition.label, name: name,
                                                       reason: "薬剤にレセプト電算コードがありません")
            next nil
          end

          dose = administration.dig("dosage", "dose")
          BillingLine.new(code: code, name: name, kind: :medicine,
                          quantity: dose && dose["value"] ? Numbers.format(dose["value"]) : nil,
                          unit: dose&.dig("unit"))
        end
      end

      def material_lines(record, definition, rad_materials)
        Array(record.hub["usedCode"]).filter_map do |concept|
          code, name = material_code(concept, rad_materials)
          if code.blank?
            skipped << BillingClaimBuilder::Skipped.new(kind: definition.label, name: name,
                                                       reason: "材料に特定器材コードがありません")
            next nil
          end

          quantity = Array(concept["extension"]).find { |e| e["url"] == definition.material_quantity_ext }
                                                &.dig("valueQuantity")
          BillingLine.new(code: code, name: name, kind: :material,
                          quantity: quantity && quantity["value"] ? Numbers.format(quantity["value"]) : "1",
                          unit: quantity&.dig("unit"))
        end
      end

      def material_code(concept, rad_materials)
        direct = Coding.code_of(concept, Coding::MEDICAL_MATERIAL)
        return [direct, Coding.label_of(concept, Coding::MEDICAL_MATERIAL)] if direct

        local = Coding.code_of(concept, Coding::RAD_MATERIAL)
        [rad_materials[local], Coding.label_of(concept, Coding::RAD_MATERIAL)]
      end

      def comment_lines(record)
        Array(record.hub["note"]).filter_map do |note|
          text = note["text"].to_s.strip
          next nil if text.empty?

          BillingLine.new(code: FREE_COMMENT_CODE, name: text, kind: :comment)
        end
      end

      # 放射線の器材は施設内の器材マスタを指すので、特定器材コードに読み替える。
      def rad_material_codes(records)
        codes = records.flat_map { |r| Array(r.hub["usedCode"]) }
                       .filter_map { |c| Coding.code_of(c, Coding::RAD_MATERIAL) }.uniq
        return {} if codes.empty?

        Master::RadMaterial.where(material_code: codes)
                           .where.not(receipt_material_code: [nil, ""])
                           .pluck(:material_code, :receipt_material_code).to_h
      end

      def fill_sections(items)
        lines = items.flat_map(&:lines).select { |l| l.kind == :procedure }
        sections = ProcedureSections.lookup(lines.map(&:code))
        lines.each { |line| line.section = sections[line.code] }
      end
    end
  end
end
