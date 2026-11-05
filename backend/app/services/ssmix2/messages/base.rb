module Ssmix2
  module Messages
    # メッセージ 1 件の組み立ての親。MSH / EVN / PID / PV1 を共通で組み、子が本体のセグメントと
    # SS-MIX ヘッダー項目(データ種別・診療日・オーダ No・処理区分・診療科)を決める。
    class Base
      Result = Struct.new(:data_kind, :service_date, :order_no, :process, :department_code, :hl7, :warnings,
                          keyword_init: true)

      # 患者基本・病名・アレルギーの「日付の概念がない」診療日。
      UNDATED = "-".freeze

      attr_reader :context, :transaction, :written, :warnings

      # written は Dispatcher が解いた書き込み(Dispatcher::Written)。
      def initialize(context:, transaction:, written:)
        @context = context
        @transaction = transaction
        @written = written
        @warnings = []
        @builder = Hl7::Builder.new
      end

      def build
        raise NotImplementedError
      end

      private

      attr_reader :builder

      def warn(message)
        @warnings << message unless @warnings.include?(message)
      end

      def result(data_kind:, service_date:, order_no:, process:, department_code:)
        Result.new(data_kind: data_kind, service_date: service_date, order_no: order_no, process: process,
                   department_code: department_code, hl7: builder.to_s, warnings: warnings)
      end

      def msh(message_type)
        builder.msh(
          sending_application: Settings.sending_application,
          sending_facility: Settings.facility_id,
          message_type: message_type,
          control_id: control_id,
          at: transaction.occurred_at
        )
      end

      # MSH-10。transaction の id と連番で一意にする(20 桁以内)。
      def control_id
        format("%d%03d", transaction.id, context.next_control_number(transaction.id))
      end

      # EVN。EVN-2 記録日時、EVN-5 操作者、EVN-6 事象発生日時(転棟・外出泊のときだけ)、EVN-7 事象施設。
      def evn(occurred: nil)
        builder.add("EVN", "", Hl7::Stamp.format(transaction.occurred_at), "", "", actor_xcn,
                    occurred ? Hl7::Stamp.format(occurred) : "", Hl7::Types.text(Settings.facility_id))
      end

      def pid(patient, with_updated_at: false)
        name = Fhir.name(patient)
        address = Array(patient["address"]).first
        fields = Array.new(39, "")
        fields[0] = "0001"
        fields[2] = Hl7::Types.cx(patient_id(patient))
        fields[4] = Hl7::Types.repeats(
          Hl7::Types.xpn(name.family_kanji, name.given_kanji, "I"),
          name.family_kana.present? || name.given_kana.present? ? Hl7::Types.xpn(name.family_kana, name.given_kana, "P") : ""
        )
        fields[6] = Hl7::Stamp.day(patient["birthDate"])
        fields[7] = Codes.gender(patient["gender"])
        fields[10] = address ? Hl7::Types.xad(address["postalCode"], Fhir.address_text(address)) : ""
        fields[12] = Fhir.phone(patient, "home").then { |n| n ? Hl7::Types.xtn(n) : "" }
        fields[13] = Fhir.phone(patient, "work").then { |n| n ? Hl7::Types.xtn(n, use: "WPN") : "" }
        fields[32] = Hl7::Stamp.format(patient.dig("meta", "lastUpdated") || transaction.occurred_at) if with_updated_at
        builder.add("PID", *fields)
      end

      # 患者 ID(前ゼロ)。identifier が無い患者は FHIR id で代える(warning)。
      def patient_id(patient)
        number = Fhir.patient_number(patient)
        if number.nil?
          warn("患者番号が無いので FHIR の id を患者 ID に使いました: Patient/#{patient['id']}")
          number = patient["id"]
        end
        Codes.patient_id(number, Settings.patient_id_digits)
      end

      # PV1。入院中なら I と所在(病棟^病室^ベッド)・主治医、外来なら O と診療科。
      # encounter を渡さなければ患者の現在の入院を探す。department は外来の PV1-3 に使う診療科コード。
      def pv1(patient, encounter: :current, department_code: nil, extra: {})
        encounter = context.current_admission(patient["id"]) if encounter == :current
        fields = Array.new(52, "")
        fields[0] = "0001"
        if encounter && inpatient?(encounter)
          fields[1] = "I"
          fields[2] = inpatient_location(encounter)
          attending = Fhir.participant_reference(encounter, "ATND")
          fields[6] = practitioner_xcn(attending) if attending
          fields[43] = Hl7::Stamp.format(encounter.dig("period", "start"))
          fields[44] = Hl7::Stamp.format(encounter.dig("period", "end"))
        else
          fields[1] = "O"
          fields[2] = department_code ? Hl7::Types.pl_outpatient(department_code) : ""
        end
        extra.each { |index, value| fields[index - 1] = value }
        builder.add("PV1", *fields)
      end

      def inpatient?(encounter)
        encounter.dig("class", "code") == "IMP"
      end

      # PV2。extra は PV2-n(1 始まり)→ 値。入退院・転科転棟の予定(PV2-8 / PV2-9)と予定の取消(PV2-1)で使う。
      # 書く値が無ければ(日付未定の入院予定)セグメントごと省く。
      def pv2(extra)
        return if extra.values.all?(&:blank?)

        fields = Array.new(42, "")
        extra.each { |index, value| fields[index - 1] = value }
        builder.add("PV2", *fields)
      end

      # 入院予定の所在。予定の Encounter は病棟・病室・ベッドを physicalType 付きで並べる(実施前は床が決まらない)。
      def planned_location(encounter)
        by_type = Array(encounter["location"]).each_with_object({}) do |entry, found|
          type = Fhir.coding(entry["physicalType"], Fhir::PHYSICAL_TYPE_SYSTEM)&.dig("code")
          found[type] ||= context.by_reference(entry.dig("location", "reference")) if type
        end
        return "" if by_type.empty?

        Hl7::Types.pl_inpatient(location_code(by_type["wa"]), location_code(by_type["ro"]), location_code(by_type["bd"]))
      end

      # TQ1。extra は TQ1-n(1 始まり)→ 値。TQ1-1 は 1、TQ1-9 は省略しない(放射線・生理の規約)。
      def tq1(extra)
        fields = Array.new(14, "")
        fields[0] = "1"
        extra.each { |index, value| fields[index - 1] = value }
        builder.add("TQ1", *fields)
      end

      # AL1。アレルギーの参照(AllergyIntolerance)の配列から患者の禁忌を並べる(給食オーダー)。
      def al1(allergy_references)
        allergy_references.each_with_index do |reference, index|
          allergy = context.by_reference(reference)
          next if allergy.nil?

          coding = Fhir.first_coding(allergy["code"])
          builder.add("AL1", (index + 1).to_s, Codes.allergen_type_cwe(Array(allergy["category"]).first),
                      coding ? Hl7::Types.cwe(coding["code"], coding["display"] || Fhir.display_of(allergy["code"]), "99ZAL") : Hl7::Types.cwe("", Fhir.display_of(allergy["code"]), "99ZAL"),
                      Codes.allergy_severity_cwe(allergy["criticality"]))
        end
      end

      # オーダーの入外区分と、入院なら在院中の入院(PV1 に使う)。encounter 参照があればそれを優先する。
      def encounter_for(resource, inpatient)
        reference = resource&.dig("encounter", "reference")
        return context.by_reference(reference) if reference.present?

        inpatient ? :current : nil
      end

      # 実施者(Procedure.performer / MedicationAdministration.performer)の XCN。
      def performer_xcn(resource)
        reference = Array(resource&.dig("performer")).map { |p| p.dig("actor", "reference") }.find { |r| r.to_s.start_with?("Practitioner/") }
        reference ? practitioner_xcn(reference) : ""
      end

      # オーダーの明細(basedOn でヘッダーを指す ServiceRequest)。同じ transaction で書かれた分を上流の分に重ねる。
      # パネル・セットの構成項目も含めて返す。
      def item_requests_of(header, item_system)
        found = context.search("ServiceRequest", { "based-on" => "ServiceRequest/#{header['id']}", "_count" => 200 })
        by_id = found.select { |sr| Fhir.coding(sr["code"], item_system) }.index_by { |sr| sr["id"] }
        Dispatcher.written_resources(transaction).each do |w|
          next unless w.type == "ServiceRequest" && w.method != "DELETE" && w.resource && w.id != header["id"]
          next unless Fhir.coding(w.resource["code"], item_system)

          by_id[w.id] = w.resource
        end
        by_id.values
      end

      # 明細のうちヘッダー直下のもの(セットと単項目)。
      def top_level_items(header, items)
        top = items.select { |sr| Array(sr["basedOn"]).any? { |b| b["reference"] == "ServiceRequest/#{header['id']}" } }
        top.empty? ? items : top
      end

      # セットを構成項目に展開した末端の項目。
      def leaf_items(group, items)
        group.flat_map do |sr|
          children = items.select { |c| Array(c["basedOn"]).any? { |b| b["reference"] == "ServiceRequest/#{sr['id']}" } }
          children.any? ? leaf_items(children, items) : [sr]
        end
      end

      # 明細の並び(オーダー内の項目番号)。
      def item_number(sr)
        Array(sr["identifier"]).find { |i| i["system"].to_s.end_with?("-order-item-number") }&.dig("value").to_i
      end

      # 書き込みの前の版。POST と初版は nil。
      def previous_version(type, resource)
        return nil if written.method == "POST" || written.version.nil? || written.version <= 1

        context.vread(type, resource["id"], written.version - 1)
      end

      # ハブ(実施の Procedure)に partOf でぶら下がるリソース。同じ transaction で書かれた分を上流の分に重ね、
      # ハブの削除では同じ transaction で消された分の最後の中身を使う。
      def part_of_resources(type, hub_reference)
        in_transaction = Dispatcher.written_resources(transaction, all: true).select { |w| w.type == type }
        if written.method == "DELETE"
          return in_transaction.select { |w| w.method == "DELETE" }
                               .filter_map { |w| context.last_version(type, w.id) }
                               .select { |r| part_of?(r, hub_reference) }
        end

        found = written.method == "POST" ? [] : context.search(type, { "part-of" => hub_reference, "_count" => 200 })
        by_id = found.index_by { |r| r["id"] }
        in_transaction.each do |w|
          if w.method == "DELETE"
            by_id.delete(w.id)
          elsif w.resource && part_of?(w.resource, hub_reference)
            by_id[w.id] = w.resource
          end
        end
        by_id.values.reject { |r| r["status"] == "entered-in-error" }
      end

      def part_of?(resource, reference)
        Array(resource["partOf"]).any? { |p| p["reference"] == reference }
      end

      def number(value)
        return "" if value.nil?

        float = value.to_f
        float == float.to_i ? float.to_i.to_s : float.to_s
      end

      # 病棟・病室・ベッドの Location はコード identifier を持たないので、name(無ければ id)を使う。
      def inpatient_location(encounter)
        bed_reference = Array(encounter["location"]).first&.dig("location", "reference")
        return "" if bed_reference.nil?

        chain = context.location_chain(bed_reference)
        Hl7::Types.pl_inpatient(location_code(chain["wa"]), location_code(chain["ro"]), location_code(chain["bd"]))
      end

      def location_code(location)
        return "" if location.nil?

        location["name"].presence || location["id"]
      end

      # 医療従事者の XCN。ID は医籍登録番号(qualification)、無ければ FHIR の id。
      def practitioner_xcn(reference)
        practitioner = context.by_reference(reference)
        id = Fhir.reference_id(reference)
        return Hl7::Types.xcn(id, "", "", "I") if practitioner.nil?

        name = Fhir.name(practitioner)
        Hl7::Types.xcn(practitioner_id(practitioner), name.family_kanji, name.given_kanji, "I")
      end

      def practitioner_id(practitioner)
        Array(practitioner["qualification"]).each do |q|
          value = Fhir.identifier_value(q, Fhir::MEDICAL_REGISTRATION_NUMBER_SYSTEM)
          return value if value.present?
        end
        practitioner["id"]
      end

      def actor_xcn
        return "" if transaction.actor_practitioner_id.blank?

        practitioner_xcn("Practitioner/#{transaction.actor_practitioner_id}")
      end

      # 診療科コード。Organization の SS-MIX2 統一診療科コード。無ければ nil(warning)。
      def department_code_of(organization_reference)
        return nil if organization_reference.blank?

        organization = context.by_reference(organization_reference)
        code = Fhir.department_code(organization)
        warn("診療科に SS-MIX2 のコードが無いので「-」にしました: #{organization_reference}") if code.nil?
        code
      end

      # ORC-17 入力組織。<コード>^<名称>^HL70069、コードが無ければ名称だけをローカルで。
      def department_cwe(organization_reference)
        return "" if organization_reference.blank?

        organization = context.by_reference(organization_reference)
        code = Fhir.department_code(organization)
        name = organization&.dig("name")
        code ? Hl7::Types.cwe(code, name, "HL70069") : Hl7::Types.cwe("", name, "99ZDP")
      end

      # 患者。参照("Patient/1")で引き、無ければ例外(PID を組めないメッセージは作らない)。
      def patient_of(reference)
        patient = context.by_reference(reference)
        raise "患者が読めません: #{reference}" if patient.nil?

        patient
      end

      # ORC。order_control は NW / CA / SC、order_no は 15 桁、header はオーダーヘッダーの ServiceRequest。
      # extra は ORC-n(1 始まり)→ 値の追加。
      def orc(order_control, order_no, header, inpatient:, extra: {})
        fields = Array.new(30, "")
        fields[0] = order_control
        fields[1] = Hl7::Types.ei(order_no)
        fields[8] = Hl7::Stamp.format(header&.dig("authoredOn") || transaction.occurred_at)
        fields[9] = actor_xcn
        requester = header&.dig("requester", "reference")
        fields[11] = practitioner_xcn(requester) if requester.present?
        fields[16] = department_cwe(Fhir.department_reference(header))
        institution = context.institution
        if institution
          fields[20] = Hl7::Types.text(institution["name"])
          address = Array(institution["address"]).first
          fields[21] = Hl7::Types.xad(address["postalCode"], Fhir.address_text(address), type: "") if address
          phone = Fhir.phone(institution, "work") || Fhir.phone(institution, "home")
          fields[22] = Hl7::Types.components("", "", "", "", "", "", "", "", "", "", "", Hl7::Types.text(phone)) if phone
        end
        fields[28] = inpatient ? "I^入院患者オーダ^HL70482" : "O^外来患者オーダ^HL70482"
        extra.each { |index, value| fields[index - 1] = value }
        builder.add("ORC", *fields)
      end

      # オーダーの入外区分(prescription-setting / lab-result-setting)が入院か。
      def inpatient_setting?(resource, system)
        Fhir.category_code(resource, system) == "inpatient"
      end

      # 書き込みの種類から処理区分とオーダ制御を決める。取消・削除は DEL / CA。
      def cancelled?(resource)
        %w[revoked cancelled entered-in-error].include?(resource&.dig("status"))
      end
    end
  end
end
