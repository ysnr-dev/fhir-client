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
        @control_count = (@control_count || 0) + 1
        format("%d%03d", transaction.id, @control_count)
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
