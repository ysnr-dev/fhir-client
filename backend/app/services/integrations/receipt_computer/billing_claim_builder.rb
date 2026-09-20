module Integrations
  module ReceiptComputer
    # 外来 1 日ぶんの診療行為を中立の明細に組む。
    #
    # 集める単位は「患者 + 診療日」。オーダーは Encounter を参照していない
    # (カルテでは日付で束ねている)ので、日付で揃えるのが素直。
    #
    # レセプト電算コードが引けない項目は落とすが、黙って消さずに skipped に積んで
    # プレビューとログに出す。
    class BillingClaimBuilder
      include Records

      # 取り消されたオーダーは会計に載せない。
      DEAD_STATUSES = %w[revoked entered-in-error draft].freeze

      # 処方の剤区分。中立の語彙で持ち、レセコン側の区分はアダプタが付ける。
      ORAL = :oral
      AS_NEEDED = :as_needed
      TOPICAL = :topical

      Skipped = Struct.new(:kind, :name, :reason, keyword_init: true)
      Built = Struct.new(:items, :skipped, keyword_init: true) do
        def empty? = items.empty?
      end

      def initialize(store: FhirStore.new)
        @store = store
      end

      def call(patient_fhir_id:, perform_date:)
        date = perform_date.to_s
        skipped = []
        items = prescription_items(patient_fhir_id, date, skipped) +
                order_items(patient_fhir_id, date, skipped)

        Built.new(items: items, skipped: skipped)
      end

      private

      attr_reader :store

      def alive?(resource) = DEAD_STATUSES.exclude?(resource["status"])

      def on_date?(resource, date) = resource["authoredOn"].to_s[0, 10] == date

      # ---- 処方 ----

      def prescription_items(patient_fhir_id, date, skipped)
        requests = store
                   .search("MedicationRequest",
                           { "subject" => "Patient/#{patient_fhir_id}", "authoredon" => date, "_count" => "500" })
                   .select { |r| alive?(r) && on_date?(r, date) }

        # RP 番号でまとめる。1 つの RP が 1 つの剤になる。
        requests.group_by { |r| rp_number(r) }.sort_by { |rp, _| rp.to_i }.filter_map do |rp, lines|
          build_prescription(rp, lines, skipped)
        end
      end

      def rp_number(request)
        Array(request["identifier"])
          .find { |i| i["system"] == Coding::RP_GROUP_NUMBER }&.dig("value") || "1"
      end

      def build_prescription(rp_number, lines, skipped)
        dosage = lines.first.dig("dosageInstruction", 0) || {}
        usage = Coding.find(dosage.dig("timing", "code"), Coding::USAGE_CODE)
        category = Coding.code_of(dosage.dig("timing", "code"), Coding::USAGE_CATEGORY)

        kind = prescription_kind(category, dosage)
        if kind.nil?
          lines.each do |line|
            skipped << Skipped.new(kind: "処方", name: medication_name(line),
                                   reason: "内服・外用のいずれでもないため送れません")
          end
          return nil
        end

        built = lines.filter_map { |line| prescription_line(line, skipped) }
        return nil if built.empty?

        BillingItem.new(
          category: kind,
          name: "RP#{rp_number}",
          lines: built,
          days: prescription_count(lines.first, dosage),
          usage_code: usage&.dig("code"),
          usage_name: usage&.dig("display")
        )
      end

      def prescription_kind(category, dosage)
        # 頓用は用法マスタの基本区分に無い(内服・外用・注射・注入の 4 種)ので、
        # カルテが dosageInstruction に立てたフラグで見分ける。
        return AS_NEEDED if dosage["asNeededBoolean"]
        return ORAL if category == OrderCatalog::USAGE_CATEGORY_ORAL
        return TOPICAL if category == OrderCatalog::USAGE_CATEGORY_TOPICAL

        # 注射・注入は剤の組み方も算定も別で、外来の会計では扱えない(第2段階)。
        nil
      end

      # 内服は投与日数、頓用は投与回数。
      def prescription_count(request, dosage)
        days = request.dig("dispenseRequest", "expectedSupplyDuration", "value")
        return format_number(days) if days.present?

        count = dosage.dig("timing", "repeat", "count")
        return format_number(count) if count.present?

        "1"
      end

      def prescription_line(request, skipped)
        concept = request["medicationCodeableConcept"]
        code = Coding.code_of(concept, Coding::MEDICINE_CODE)

        if code.blank?
          # 一般名処方は銘柄を指さないので、そのままではレセ電算コードにならない。
          reason = if Coding.code_of(concept, Coding::GENERAL_ORDER_CODE)
                     "一般名処方はレセプト電算コードに解決できません"
                   else
                     "レセプト電算コードがありません"
                   end
          skipped << Skipped.new(kind: "処方", name: medication_name(request), reason: reason)
          return nil
        end

        BillingLine.new(code: code, name: medication_name(request), quantity: dose_of(request))
      end

      def medication_name(request)
        request.dig("medicationCodeableConcept", "text").presence || ""
      end

      def dose_of(request)
        value = request.dig("dosageInstruction", 0, "doseAndRate", 0, "doseQuantity", "value")
        value.nil? ? nil : format_number(value)
      end

      # 1.0 を "1" に、0.5 を "0.5" にする。
      def format_number(value)
        float = value.to_f
        float == float.to_i ? float.to_i.to_s : float.to_s
      end

      # ---- 検査・処置・手術などのオーダー ----

      def order_items(patient_fhir_id, date, skipped)
        requests = store
                   .search("ServiceRequest",
                           { "subject" => "Patient/#{patient_fhir_id}", "authoredon" => date, "_count" => "500" })
                   .select { |r| alive?(r) }

        headers = requests.select { |r| Coding.code_in_list(r["category"], Coding::ORDER_TYPE).present? }
                          .select { |r| on_date?(r, date) }
        details_by_parent = group_details(requests)

        headers.filter_map do |header|
          order_type = Coding.code_in_list(header["category"], Coding::ORDER_TYPE)
          definition = OrderCatalog.find(order_type)
          details = details_by_parent[header["id"]] || []
          next if details.empty?

          if definition.nil?
            unless ignorable?(order_type)
              skipped << Skipped.new(kind: order_type, name: header.dig("code", "text").presence || order_type,
                                     reason: "この種別はまだ医事会計へ送りません")
            end
            next
          end

          build_order_item(definition, details, skipped)
        end
      end

      # 処方は別経路で送るので「送れなかった」扱いにしない。
      def ignorable?(order_type) = order_type == "prescription"

      def group_details(requests)
        requests.each_with_object(Hash.new { |h, k| h[k] = [] }) do |request, acc|
          Array(request["basedOn"]).each do |reference|
            id = reference["reference"].to_s.split("/").last
            acc[id] << request if id.present?
          end
        end
      end

      def build_order_item(definition, details, skipped)
        item_codes = details.filter_map { |d| Coding.code_of(d["code"], definition.coding_system) }
        receipt_codes = definition.receipt_codes(item_codes)

        lines = details.filter_map do |detail|
          item_code = Coding.code_of(detail["code"], definition.coding_system)
          name = detail.dig("code", "text").presence || ""
          receipt_code = receipt_codes[item_code]

          if receipt_code.blank?
            skipped << Skipped.new(kind: definition.label, name: name,
                                   reason: "項目マスタにレセプト電算コードが設定されていません")
            next
          end

          BillingLine.new(code: receipt_code, name: name, quantity: "1")
        end
        return nil if lines.empty?

        BillingItem.new(category: definition.order_type.to_sym, name: definition.label, lines: lines)
      end
    end
  end
end
