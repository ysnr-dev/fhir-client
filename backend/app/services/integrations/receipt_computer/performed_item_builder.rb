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
      # service_requests は当日のオーダーのヘッダ(id → リソース)。リハビリの疾患別区分の
      # ようにオーダー側にしか無い情報を resolver が引く。当日の集合に無ければ上流から読む。
      # details_by_parent はオーダーのヘッダ id → 明細(ServiceRequest)の配列。放射線の撮影部位の
      # コメント(項目マスタの列)は、実施記録ではなくオーダーの項目から引く。
      def initialize(skipped, medication_requests: {}, service_requests: {}, details_by_parent: {}, store: nil)
        @skipped = skipped
        @medication_requests = medication_requests
        @service_requests = service_requests
        @details_by_parent = details_by_parent
        @store = store
        @resolvers = {}
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

      attr_reader :skipped, :medication_requests, :service_requests, :details_by_parent, :store

      def build(record, rad_materials)
        definition = OrderCatalog.find(record.order_type)
        return nil if definition.nil?

        head, count = head_lines(record, definition)
        return nil if head.nil?

        lines = head +
                site_comment_lines(record, definition) +
                medicine_lines(record, definition) +
                material_lines(record, definition, rad_materials) +
                comment_lines(record)
        return nil if lines.empty?

        item = BillingItem.new(category: definition.order_type.to_sym, name: definition.label, lines: lines,
                               count: count, performed_at: record.performed_at,
                               source_ref: "Procedure/#{record.id}",
                               order_ref: record.order_id && "ServiceRequest/#{record.order_id}")
        fill_injection(item, record) if definition.order_type == "injection"
        item
      end

      # 手技の行と回数。項目マスタで引ける種別はハブと子の code、resolver を持つ種別は
      # その変換、注射は手技を持たない。resolver が nil を返したら(送れない・対象外)剤ごと作らない。
      def head_lines(record, definition)
        if definition.resolver
          resolved = resolver(definition).call(record, order_for(record))
          resolved.nil? ? [nil, nil] : resolved
        elsif definition.coded_hub?
          [procedure_lines(record, definition), nil]
        else
          [[], nil]
        end
      end

      def resolver(definition)
        @resolvers[definition.order_type] ||= definition.resolver_for(skipped: skipped, store: store)
      end

      def order_for(record)
        id = record.order_id
        return nil if id.blank?
        return service_requests[id] if service_requests.key?(id)

        service_requests[id] = store&.read_or_nil("ServiceRequest", id)
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

      # 薬剤。輸血製剤(製剤マスタの体系)は Resolvers::Transfusion が医薬品コードに読み替えて
      # 送るので、ここでは扱わない。
      def medicine_lines(record, definition)
        record.administrations.filter_map do |administration|
          concept = administration["medicationCodeableConcept"]
          next nil if Coding.find(concept, Coding::TRANSFUSION_PRODUCT)

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

      # usedCode のうち材料の体系(特定器材・放射線の器材マスタ)のものだけを送る。
      # 放射線治療の治療装置のように、算定しない道具が usedCode に載る種別もある。
      def material_lines(record, definition, rad_materials)
        Array(record.hub["usedCode"]).filter_map do |concept|
          next nil unless Coding.find(concept, Coding::MEDICAL_MATERIAL) || Coding.find(concept, Coding::RAD_MATERIAL)

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

      # 撮影部位の選択式コメント(820 系)。放射線項目マスタの列で、オーダーの項目ごとに 1 つ。
      # 同じ部位が複数の項目に付いていても 1 回にする。
      def site_comment_lines(record, definition)
        return [] unless definition.order_type == "rad"

        details = details_by_parent[record.order_id] || []
        item_codes = details.filter_map { |d| Coding.code_of(d["code"], definition.coding_system) }
        return [] if item_codes.empty?

        codes = Master::RadItem.where(item_code: item_codes).where.not(site_comment_code: [nil, ""])
                               .pluck(:site_comment_code).uniq
        names = Master::Comment.where(comment_code: codes).pluck(:comment_code, :name).to_h
        codes.map { |code| BillingLine.new(code: code, name: names[code] || code, kind: :comment) }
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
