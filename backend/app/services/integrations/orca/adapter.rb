module Integrations
  module Orca
    # 日レセ(WebORCA)用のレセコンアダプタ。
    #
    # 日レセの語彙(保険組合せ番号・Medical_Class・Api_Result・電文の項目名)は
    # このクラスとその下で完結させ、外へは中立の値オブジェクトだけを返す。
    class Adapter
      include ReceiptComputer::Records

      SYSTEM_TYPE = "orca".freeze

      # 対応表に持つ種別。診療科は SS-MIX2 統一診療科コードの 01〜39 がレセ電算
      # 「別表10」と同値なので、対応が無ければそのまま使う。医師は日レセの
      # ドクターコード(5桁)に当たる識別子がカルテに無いので対応付けが要る。
      CODE_KINDS = [
        { key: "department", label: "診療科", local: "ssmix2_department", fallback: :identity },
        { key: "physician", label: "医師", local: "practitioner", fallback: nil }
      ].freeze

      OPTION_FIELDS = [
        { key: "api_prefix", label: "API パス接頭辞", default: "/api" }
      ].freeze

      class << self
        def system_type = SYSTEM_TYPE
        def code_kinds = CODE_KINDS
        def option_fields = OPTION_FIELDS
      end

      def initialize(config)
        @config = config
        @gateway = Gateway.new(config)
      end

      def system_type = SYSTEM_TYPE
      def code_kinds = CODE_KINDS

      def test_connection
        info = system_api.institution
        { ok: true, facility_name: info[:name], facility_number: info[:institution_number] }
      rescue Gateway::NotConfigured => e
        raise ReceiptComputer::NotConfigured, e.message
      rescue Gateway::InvalidResponse => e
        { ok: false, message: e.message }
      end

      def code_candidates(kind)
        case kind.to_s
        when "department"
          system_api.departments.map { |d| { code: d.code, label: d.name } }
        when "physician"
          system_api.physicians.map { |p| { code: p.code, label: p.name } }
        else
          []
        end
      end

      def fetch_patient(patient_number)
        translate { patient_api.fetch(patient_number) }
      end

      def billing_status(patient_number:, date:, department_code:)
        uid = translate do
          medical_api.find_uid(patient_id: patient_number, perform_date: date,
                               department_code: department_code)
        end
        BillingStatus.new(sent: uid.present?, detail: uid)
      end

      def send_billing(claim)
        classes, dropped = MedicalMessage.build(claim.items)
        if classes.empty?
          return Result.new(outcome: :failed, code: "no_items",
                            message: "医事会計へ送れる診療行為がありません",
                            skipped: dropped)
        end

        result = translate do
          medical_api.register(classes,
                               patient_id: claim.patient_number,
                               perform_date: claim.date,
                               department_code: claim.department_code,
                               physician_code: claim.physician_code,
                               coverage_set_key: claim.coverage_set_key,
                               medical_fee_auto: claim.auto_basic_fee != false)
        end

        to_result(result, skipped: dropped)
      end

      def cancel_billing(patient_number:, date:, department_code:)
        result = translate do
          medical_api.cancel(patient_id: patient_number, perform_date: date,
                             department_code: department_code)
        end
        if result.nil?
          return Result.new(outcome: :failed, code: "not_found",
                            message: "医事会計に送った診療行為が見つかりません")
        end

        to_result(result)
      end

      def send_diagnoses(patient_number:, date:, department_code:, coverage_set_key:, diagnoses:)
        children, skipped = DiseaseMessage.build(diagnoses, coverage_set_key)
        # 送れる病名が 1 件も無ければ日レセを叩かない(空配列を送るとエラーになる)。
        return nil if children.empty?

        result = translate do
          disease_api.register(children, patient_id: patient_number, perform_date: date,
                                         department_code: department_code)
        end

        # E40 は「廃止・移行先のある病名が混ざっている」。登録はされるので警告扱い。
        outcome = result.api_result.code == DiseaseApi::WARNING_RESULT ? :warning : nil
        to_result(result, skipped: skipped, outcome: outcome)
      end

      private

      attr_reader :config, :gateway

      def system_api = @system_api ||= SystemApi.new(gateway)
      def patient_api = @patient_api ||= PatientApi.new(gateway)
      def medical_api = @medical_api ||= MedicalApi.new(gateway)
      def disease_api = @disease_api ||= DiseaseApi.new(gateway)

      # 日レセ側の例外を、連携先に依らない意味の例外へ読み替える。
      def translate
        yield
      rescue Gateway::NotConfigured => e
        raise ReceiptComputer::NotConfigured, e.message
      rescue Gateway::InvalidResponse => e
        raise ReceiptComputer::Rejected, e.message
      rescue Faraday::ConnectionFailed, Faraday::TimeoutError => e
        raise ReceiptComputer::Unreachable, "医事会計システムに接続できません: #{e.message}"
      end

      # Api_Result は成功でも部分的に落ちていることがあるので、
      # 送れなかった項目があれば警告に落として「そのまま成功」とは言わない。
      def to_result(result, skipped: [], outcome: nil)
        decided = outcome || begin
          if !result.ok? then :failed
          elsif skipped.any? || result.api_result.warnings.any? then :warning
          else :succeeded
          end
        end

        Result.new(
          outcome: decided,
          code: result.api_result.code,
          message: result.api_result.message,
          warnings: result.api_result.warnings,
          skipped: skipped
        )
      end
    end
  end
end
