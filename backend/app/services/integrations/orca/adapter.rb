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

      # 会計済み → 日レセ側で展開・編集済み → カルテから送ってある → 未送信 の順に見る。
      # 会計が済んだ後や医事課が画面で触った後に送り直すと、失敗するか確定した会計と
      # 食い違う中途データを作るので、その状態を画面に伝えて送信を止める。
      def billing_status(patient_number:, date:, department_code:)
        translate do
          if accept_api.settled?(patient_id: patient_number, date: date, department_code: department_code)
            return BillingStatus.new(state: :settled, message: "医事会計で会計済みです。変更は医事会計側で行ってください",
                                     settlements: income_api.settlements(patient_id: patient_number, date: date))
          end

          entry = medical_api.find_entry(patient_id: patient_number, perform_date: date,
                                         department_code: department_code)
          if entry.nil?
            BillingStatus.new(state: :none)
          elsif entry.controllable?
            BillingStatus.new(state: :sent, detail: entry.uid)
          else
            BillingStatus.new(state: :opened, detail: entry.uid,
                              message: "医事会計側で展開・編集された診療データがあり、カルテからは送り直し・取消ができません")
          end
        end
      end

      # 画面に見せる剤。日レセの剤(診療種別区分ごと)に分けた並びを、区分名つきで返す。
      def describe_billing(items)
        groups, dropped = MedicalMessage.split(items)
        described = groups.map do |group|
          PreviewItem.new(
            category: group.item.category, name: group.item.name,
            class_code: group.medical_class, class_name: MedicalMessage.class_name(group.medical_class),
            count: group.item.count, days: group.item.days, usage_name: group.item.usage_name,
            performed_at: group.item.performed_at, lines: group.lines
          )
        end
        [described, dropped]
      end

      # その日に会計が済んだ受診。患者番号は日レセの形(ゼロ埋め)のまま返し、読み替えは呼び側。
      def settled_receptions(date:)
        translate do
          accept_api.settled_receptions(date: date).map do |row|
            SettledReception.new(patient_number: row["Patient_ID"].to_s, department_code: row["Department_Code"].presence)
          end
        end
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
                               perform_time: claim.time,
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
      def accept_api = @accept_api ||= AcceptApi.new(gateway)
      def income_api = @income_api ||= IncomeApi.new(gateway)

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
      # 日レセが黙って落とした明細(M01 など)は、カルテ側で送れなかった項目と同じ器に入れる。
      def to_result(result, skipped: [], outcome: nil)
        api_result = result.api_result
        dropped = api_result.dropped_line_warnings.map do |w|
          { kind: "医事会計", name: w["target_name"] || w["target_code"] || "明細 #{w['position']}",
            reason: "#{w['message']}(日レセに取り込まれませんでした)" }
        end
        warnings = api_result.warnings - api_result.dropped_line_warnings
        all_skipped = skipped + dropped

        decided = outcome || begin
          if !api_result.ok? then :failed
          elsif all_skipped.any? || warnings.any? then :warning
          else :succeeded
          end
        end

        Result.new(
          outcome: decided,
          code: api_result.code,
          message: failure_message(api_result),
          warnings: warnings,
          skipped: all_skipped
        )
      end

      # 実質エラーの警告は Api_Result のメッセージ(処理終了)より警告の文言を前に出す。
      # 失敗のときは層ごとの結果(E31「同名の病名が存在します」など)を添える。Api_Result の
      # メッセージだけでは「登録出来ない病名が存在します」で、どの病名が何故かが分からない。
      def failure_message(api_result)
        fatal = api_result.fatal_warnings.first
        return "#{fatal['message']}(#{fatal['code']})。#{api_result.message}" if fatal

        return api_result.message if api_result.ok?

        detail = api_result.warnings.find { |w| w["message"].present? }
        return api_result.message if detail.nil?

        target = detail["target_name"] || detail["target_code"]
        "#{api_result.message} #{target ? "#{target}: " : ''}#{detail['message']}"
      end
    end
  end
end
