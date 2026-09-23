module Integrations
  module ReceiptComputer
    # 外来 1 日ぶんの診療行為を中立の明細に組む。
    #
    # 集める単位は「患者 + 診療日」。オーダーは Encounter を参照していない
    # (カルテでは日付で束ねている)ので、日付で揃えるのが素直。
    #
    # 何を軸にするかは種別で違う(OrderCatalog)。
    # - 実施入力を持つ種別は実施記録(Procedure)。実施した手技・薬剤・材料をそのまま送り、
    #   当日のオーダーに実施記録が無ければ「未実施」として送らない。
    # - 実施入力を持たない種別と処方はオーダー。日付はオーダーの実施(予定)日 occurrence で、
    #   登録日 authoredOn ではない(予約検査を登録した日の会計に載せないため)。
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

      # patient は年齢で変わる加算(外来化学療法加算の 15 歳未満)の判定に使う。無ければ成人扱い。
      def call(patient_fhir_id:, perform_date:, patient: nil)
        date = perform_date.to_s
        skipped = []

        requests = order_requests(patient_fhir_id, date)
        headers_by_id = requests.select { |r| r["resourceType"] == "ServiceRequest" }.index_by { |r| r["id"] }
        performed = collector.call(patient_fhir_id: patient_fhir_id, perform_date: date)
        report_orphans(performed.orphans, skipped)
        report_unfinished(performed.unfinished, skipped)
        performed_items = PerformedItemBuilder.new(skipped, medication_requests: medication_requests_by_id(requests),
                                                            service_requests: headers_by_id, store: store)
                                              .call(performed.records)
        # 中止・実施せずのオーダーも「実施記録が無い」とは別に報告済みなので、ここに含める。
        performed_order_ids = (performed.records + performed.unfinished).map(&:order_id).compact.to_set

        items = prescription_items(requests, date, skipped) +
                order_items(requests, date, skipped, performed_order_ids) +
                performed_items
        add_blood_draw(items)
        add_chemo_additions(items, headers_by_id, patient, date, skipped)

        Built.new(items: merge_repeats(items), skipped: skipped)
      end

      private

      attr_reader :store

      def collector = @collector ||= PerformedRecordCollector.new(store: store)

      def alive?(resource) = DEAD_STATUSES.exclude?(resource["status"])

      def on_date?(resource, date) = LocalDate.of(resource["occurrenceDateTime"]) == date

      # 当日実施(予定)のオーダーのヘッダと、その明細・処方薬を 1 往復で引く。
      def order_requests(patient_fhir_id, date)
        store.search("ServiceRequest", {
                       "subject" => "Patient/#{patient_fhir_id}",
                       "occurrence" => date,
                       "_revinclude" => "ServiceRequest:based-on",
                       "_revinclude:iterate" => "MedicationRequest:based-on",
                       "_count" => "500"
                     }).uniq { |r| [r["resourceType"], r["id"]] }
      end

      # 当日のオーダーのヘッダ。処方は他の種別より前からあり order-type を持たないので、
      # 種別が無いことで処方と判定する(frontend の isPrescriptionServiceRequest と同じ規約)。
      # 明細(basedOn を持つ)はヘッダではない。
      def headers_of(requests, date, prescription: false)
        requests.select { |r| r["resourceType"] == "ServiceRequest" && Array(r["basedOn"]).empty? }
                .select { |r| order_type_of(r).present? != prescription }
                .select { |r| alive?(r) && on_date?(r, date) }
      end

      def order_type_of(header) = Coding.code_in_list(header["category"], Coding::ORDER_TYPE)

      def medication_requests_by_id(requests)
        requests.select { |r| r["resourceType"] == "MedicationRequest" }.index_by { |r| r["id"] }
      end

      # basedOn でヘッダを指す明細(ServiceRequest / MedicationRequest)をヘッダ id ごとに。
      def group_by_parent(requests, resource_type)
        requests.select { |r| r["resourceType"] == resource_type && alive?(r) }
                .each_with_object(Hash.new { |h, k| h[k] = [] }) do |request, acc|
          Array(request["basedOn"]).each do |reference|
            id = Coding.reference_id(reference["reference"])
            acc[id] << request if id.present?
          end
        end
      end

      # ---- 処方 ----

      def prescription_items(requests, date, skipped)
        by_header = group_by_parent(requests, "MedicationRequest")

        headers_of(requests, date, prescription: true).flat_map do |header|
          lines = by_header[header["id"]]
          dispensing = dispensing_of(header)
          # RP 番号でまとめる。1 つの RP が 1 つの剤になる。
          lines.group_by { |r| rp_number(r) }.sort_by { |rp, _| rp.to_i }.filter_map do |rp, group|
            build_prescription(rp, group, skipped, dispensing)
          end
        end
      end

      def rp_number(request)
        Array(request["identifier"])
          .find { |i| i["system"] == Coding::RP_GROUP_NUMBER }&.dig("value") || "1"
      end

      # 院内 / 院外。同じ日に両方があると連携先で区別が要る(日レセなら 211 / 212)。
      def dispensing_of(header)
        case Coding.code_in_list(header["category"], Coding::PRESCRIPTION_CATEGORY)
        when "external" then :external
        when "internal" then :internal
        end
      end

      def build_prescription(rp_number, lines, skipped, dispensing = nil)
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
          # 外用は「総量 × 1」で入力し、日数は送らない(日数が要るのは特定疾患処方管理加算の
          # 28 日以上だけで、その判断は医事側)。
          days: kind == TOPICAL ? nil : prescription_count(lines.first, dosage),
          usage_code: usage&.dig("code"),
          usage_name: usage&.dig("display"),
          dispensing: dispensing,
          source_ref: "MedicationRequest/#{lines.first['id']}"
        )
      end

      def prescription_kind(category, dosage)
        # 頓用は用法マスタの基本区分に無い(内服・外用・注射・注入の 4 種)ので、
        # カルテが dosageInstruction に立てたフラグで見分ける。
        return AS_NEEDED if dosage["asNeededBoolean"]
        return ORAL if category == OrderCatalog::USAGE_CATEGORY_ORAL
        return TOPICAL if category == OrderCatalog::USAGE_CATEGORY_TOPICAL

        # 注射・注入の用法を持つ処方は送らない。注射は注射オーダーの実施記録から送る。
        nil
      end

      # 内服は投与日数、頓用は投与回数。
      def prescription_count(request, dosage)
        days = request.dig("dispenseRequest", "expectedSupplyDuration", "value")
        return Numbers.format(days) if days.present?

        count = dosage.dig("timing", "repeat", "count")
        return Numbers.format(count) if count.present?

        "1"
      end

      def prescription_line(request, skipped)
        concept = request["medicationCodeableConcept"]
        code = Coding.code_of(concept, Coding::MEDICINE_CODE)
        generic = false

        if code.blank?
          # 一般名処方は銘柄を指さない。レセコンには銘柄のコードに一般名の印を付けて送るので、
          # 一般名コードから代表の銘柄(最も薬価の低いもの)を引く。
          general = Coding.code_of(concept, Coding::GENERAL_ORDER_CODE)
          code = representative_brand(general) if general
          generic = code.present?
          if code.blank?
            reason = general ? "一般名処方の銘柄を医薬品マスタから引けません(#{general})" : "レセプト電算コードがありません"
            skipped << Skipped.new(kind: "処方", name: medication_name(request), reason: reason)
            return nil
          end
        end

        dose = request.dig("dosageInstruction", 0, "doseAndRate", 0, "doseQuantity")
        BillingLine.new(code: code, name: medication_name(request), kind: :medicine, generic: generic,
                        quantity: dose && dose["value"] ? Numbers.format(dose["value"]) : nil,
                        unit: dose&.dig("unit"))
      end

      # 一般名コードに対応する銘柄のうち、薬価が最も低いもの(同額ならコード順)。
      # 院外処方では薬剤料を請求しないので、どの銘柄を指すかは一般名の印さえあれば結果に響かない。
      def representative_brand(general_code)
        @brands ||= {}
        @brands.fetch(general_code) do
          # 廃止年月日は「99999999」= 廃止されていない(レセ電算の慣行)。
          @brands[general_code] = Master::Medicine.where(generic_name_code: general_code)
                                                  .where(abolished_on: [nil, "", "99999999"])
                                                  .order(:price, :medicine_code).pick(:medicine_code)
        end
      end

      def medication_name(request)
        request.dig("medicationCodeableConcept", "text").presence || ""
      end

      # ---- 検査・処置などのオーダー ----

      def order_items(requests, date, skipped, performed_order_ids)
        details_by_parent = group_by_parent(requests, "ServiceRequest")

        headers_of(requests, date).filter_map do |header|
          order_type = order_type_of(header)
          next if OrderCatalog.ignored?(order_type)

          definition = OrderCatalog.find(order_type)
          details = details_by_parent[header["id"]]

          if definition.nil?
            skipped << Skipped.new(kind: OrderCatalog.pending_label(order_type) || order_type,
                                   name: header.dig("code", "text").presence || order_type,
                                   reason: "この種別はまだ医事会計へ送りません")
            next
          end
          if definition.performed?
            next if performed_order_ids.include?(header["id"]) || definition.continuous
            next unless completed_without_record?(definition, header, details, skipped)
          end
          next if details.empty?

          if definition.resolver
            definition.resolver_for(skipped: skipped, store: store).call(header, details)
          else
            build_order_item(definition, details, skipped)
          end
        end
      end

      # 実施記録の無い当日のオーダー。実施入力をしない項目だけのオーダーは部門が
      # Task を実施済にするだけで記録を作らないので、そのときに限りオーダーから組む。
      def completed_without_record?(definition, header, details, skipped)
        item_codes = details.filter_map { |d| Coding.code_of(d["code"], definition.coding_system) }
        name = header.dig("code", "text").presence || definition.label

        if definition.perform_input_required?(item_codes)
          skipped << Skipped.new(kind: definition.label, name: name,
                                 reason: "実施記録がありません(未実施のため送りません)")
          return false
        end

        return true if task_completed?(header["id"])

        skipped << Skipped.new(kind: definition.label, name: name,
                               reason: "部門で実施済になっていません")
        false
      end

      def task_completed?(order_id)
        store.search("Task", { "focus" => "ServiceRequest/#{order_id}", "_count" => "10" }, limit: 10)
             .any? { |t| t["status"] == "completed" }
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

          quantity = detail.dig("quantityQuantity", "value")
          BillingLine.new(code: receipt_code, name: name, kind: :procedure,
                          quantity: quantity ? Numbers.format(quantity) : "1")
        end
        return nil if lines.empty?

        sections = ProcedureSections.lookup(lines.map(&:code))
        lines.each { |line| line.section = sections[line.code] }

        BillingItem.new(category: definition.order_type.to_sym, name: definition.label, lines: lines)
      end

      # 完了していない実施記録。途中で中止した分の算定(使った薬剤だけ請求するなど)は
      # 運用判断が要るので、ここでは請求せず理由だけ出す。
      UNFINISHED_REASONS = {
        "stopped" => "途中で中止された実施記録です(中止までの分は医事会計で入力してください)",
        "not-done" => "実施せずと記録されています"
      }.freeze

      def report_unfinished(records, skipped)
        records.each do |record|
          definition = OrderCatalog.find(record.order_type)
          skipped << Skipped.new(kind: definition.label, name: definition.label,
                                 reason: UNFINISHED_REASONS[record.status] || "実施が完了していません(#{record.status})")
        end
      end

      # 帰属先の無い実施記録の子・薬剤。取消の途中で残ったものなどで、送る先が決まらない。
      def report_orphans(orphans, skipped)
        orphans.each do |resource|
          concept = resource["code"] || resource["medicationCodeableConcept"]
          skipped << Skipped.new(kind: "実施記録", name: concept&.dig("text").presence || resource["id"].to_s,
                                 reason: "実施記録の親が当日に見つかりません")
        end
      end

      # ---- 送信時にルールで足す加算 ----

      # 血液採取(B-V)。検体検査に血液の検体(検体マスタの区分「血液」)があれば、その日の
      # 最初の検体検査の剤に 1 回だけ足す。設定が無ければ足さず、報告もしない(採血料を
      # 医事側で入れる運用もある)。
      BLOOD_CATEGORY = "血液".freeze

      def add_blood_draw(items)
        code = receipt_codes.blood_draw
        return if code.nil?

        lab_items = items.select { |i| i.category == :lab }
        return if lab_items.empty?

        codes = lab_items.flat_map { |i| i.lines.map(&:code) }
        specimen_codes = Master::LabOrderItem.where(receipt_code: codes).pluck(:specimen_code).compact.uniq
        return if specimen_codes.empty?
        return unless Master::LabSpecimen.where(specimen_code: specimen_codes, category: BLOOD_CATEGORY).exists?

        lab_items.first.lines << BillingLine.new(code: code, name: "血液採取", quantity: "1", kind: :procedure)
      end

      # 外来化学療法加算と無菌製剤処理料。レジメン由来の注射(ヘッダの requisition が
      # レジメン適用の uuid)があれば、その日の最初の注射の剤に 1 回だけ足す。
      REGIMEN_INSTANCE = "#{Coding::LOCAL}/Identifier/regimen-instance".freeze
      CHILD_AGE = 15

      def add_chemo_additions(items, headers_by_id, patient, date, skipped)
        target = items.find do |i|
          i.category == :injection && regimen_order?(headers_by_id[Coding.reference_id(i.order_ref)])
        end
        return if target.nil?

        child = age_on(patient, date)&.<(CHILD_AGE) || false
        chemo = receipt_codes.outpatient_chemo_addition(child: child)
        if chemo
          target.lines << BillingLine.new(code: chemo, name: "外来化学療法加算", quantity: "1", kind: :procedure)
        else
          skipped << Skipped.new(kind: "注射", name: "外来化学療法加算",
                                 reason: "施設設定に外来化学療法加算#{child ? '(15 歳未満)' : ''}のレセプト電算コードがありません")
        end

        aseptic = receipt_codes.aseptic_preparation
        target.lines << BillingLine.new(code: aseptic, name: "無菌製剤処理料", quantity: "1", kind: :procedure) if aseptic
      end

      def regimen_order?(header)
        header&.dig("requisition", "system") == REGIMEN_INSTANCE
      end

      def age_on(patient, date)
        birth = patient&.dig("birthDate")
        return nil if birth.blank?

        born = Date.parse(birth)
        day = Date.parse(date)
        day.year - born.year - (day.month > born.month || (day.month == born.month && day.day >= born.day) ? 0 : 1)
      rescue ArgumentError
        nil
      end

      def receipt_codes = @receipt_codes ||= ReceiptCodes.new

      # 同じ内容の剤(同じ処置を 2 回など)は 1 剤にまとめて回数を足す。
      # 処方は日数を持つので対象にしない(RP は 1 つが 1 剤)。
      def merge_repeats(items)
        items.each_with_object([]) do |item, acc|
          twin = item.days.nil? && acc.find { |other| other.days.nil? && same_content?(other, item) }
          if twin
            twin.count = ((twin.count || 1).to_i + (item.count || 1).to_i).to_s
          else
            acc << item
          end
        end
      end

      def same_content?(a, b)
        a.category == b.category &&
          a.lines.map { |l| [l.kind, l.code, l.quantity] } == b.lines.map { |l| [l.kind, l.code, l.quantity] }
      end
    end
  end
end
