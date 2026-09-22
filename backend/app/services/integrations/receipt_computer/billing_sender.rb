module Integrations
  module ReceiptComputer
    # カルテ → レセコンへ 1 受診ぶんの会計を送る。
    #
    # 送信済みかどうかはレセコンに訊く。カルテ側に控えを持つと、医事課が
    # レセコン側で展開・取消したときに食い違い、送り直しの判断を誤る。
    class BillingSender
      include Records

      def initialize(adapter: nil, store: FhirStore.new, log: ReceiptComputer.log)
        @adapter = adapter
        @store = store
        @log = log
      end

      # 画面に出す送信内容。送る剤・病名・送れない項目を一度に返す。
      # 剤はレセコンが実際に送る並び(区分ごと)に分けて見せる。
      def preview(patient_fhir_id:, perform_date:)
        built = builder.call(patient_fhir_id: patient_fhir_id, perform_date: perform_date)
        diagnoses = collector.call(patient_fhir_id: patient_fhir_id, perform_date: perform_date)
        described, dropped = describe(built.items)

        {
          items: described.map { |i| item_json(i) },
          diagnoses: diagnoses.map { |d| diagnosis_json(d) },
          skipped: built.skipped.map(&:to_h) + dropped
        }
      end

      def status(patient_fhir_id:, perform_date:, department_code:)
        number = patient_number!(patient_fhir_id)
        adapter.billing_status(patient_number: number, date: perform_date,
                               department_code: mapped_department(department_code))
      end

      # 病名 → 診療行為の順で送る。病名が先でないとレセコン側で査定に使えない。
      def call(patient_fhir_id:, perform_date:, department_code:, practitioner_id: nil,
               coverage_set_key: nil, requested_by: nil)
        number = patient_number!(patient_fhir_id)
        department = mapped_department(department_code)
        physician = mapper.to_external("physician", practitioner_id)

        diagnosis_result = send_diagnoses(
          number, perform_date, department, coverage_set_key, patient_fhir_id, requested_by
        )

        built = builder.call(patient_fhir_id: patient_fhir_id, perform_date: perform_date)
        claim = BillingClaim.new(
          patient_number: number, date: perform_date,
          time: exam_start_time(patient_fhir_id, perform_date),
          department_code: department, physician_code: physician,
          coverage_set_key: coverage_set_key,
          items: built.items,
          auto_basic_fee: true
        )

        result = adapter.send_billing(claim)
        result = merge_skipped(result, built.skipped)
        record("billing.send", result, patient_fhir_id: patient_fhir_id, patient_number: number,
                                       perform_date: perform_date, department_code: department,
                                       requested_by: requested_by)

        { billing: result, diagnoses: diagnosis_result }
      end

      def cancel(patient_fhir_id:, perform_date:, department_code:, requested_by: nil)
        number = patient_number!(patient_fhir_id)
        department = mapped_department(department_code)
        result = adapter.cancel_billing(patient_number: number, date: perform_date,
                                        department_code: department)
        record("billing.cancel", result, patient_fhir_id: patient_fhir_id, patient_number: number,
                                         perform_date: perform_date, department_code: department,
                                         requested_by: requested_by)
        result
      end

      private

      attr_reader :store, :log

      def adapter = @adapter ||= ReceiptComputer.adapter!

      # 接続設定が無くてもプレビューは出せるようにする(区分名が付かないだけ)。
      def describe(items)
        adapter.describe_billing(items)
      rescue NotConfigured
        [items.map { |i| PreviewItem.new(category: i.category, name: i.name, count: i.count, days: i.days,
                                         usage_name: i.usage_name, performed_at: i.performed_at,
                                         lines: i.lines) }, []]
      end

      def builder = @builder ||= BillingClaimBuilder.new(store: store)

      def collector = @collector ||= DiagnosisCollector.new(store: store)

      def mapper = @mapper ||= CodeMapper.new(adapter.system_type, adapter.code_kinds)

      def mapped_department(department_code)
        mapper.to_external("department", department_code)
      end

      def send_diagnoses(number, perform_date, department, coverage_set_key, patient_fhir_id, requested_by)
        diagnoses = collector.call(patient_fhir_id: patient_fhir_id, perform_date: perform_date)
        result = adapter.send_diagnoses(patient_number: number, date: perform_date,
                                        department_code: department,
                                        coverage_set_key: coverage_set_key,
                                        diagnoses: diagnoses)
        return nil if result.nil?

        record("diagnoses.send", result, patient_fhir_id: patient_fhir_id, patient_number: number,
                                         perform_date: perform_date, department_code: department,
                                         requested_by: requested_by)
        result
      end

      # レセプト電算コードが無くて送れなかった項目があれば、
      # レセコンが受理していても「そのまま成功」とは言わない。
      def merge_skipped(result, skipped)
        return result if skipped.empty?

        extra = skipped.map { |s| { kind: s.kind, name: s.name, reason: s.reason } }
        Result.new(
          outcome: result.outcome == :succeeded ? :warning : result.outcome,
          code: result.code, message: result.message,
          warnings: result.warnings, skipped: result.skipped + extra
        )
      end

      # 診療の開始時刻。その日の外来の Encounter(診察開始で作られる)の period.start。
      # 時間外・休日・深夜の加算はレセコンがこの時刻で判定する。
      def exam_start_time(patient_fhir_id, perform_date)
        # 診察中(終了の無い period)も引けるよう、等価ではなく「その日に始まった」で検索する。
        encounters = store.search("Encounter", { "subject" => "Patient/#{patient_fhir_id}",
                                                 "class" => "AMB",
                                                 "date" => LocalDate.starts_on(perform_date),
                                                 "_count" => "50" }, limit: 50)
        starts = encounters.filter_map { |e| e.dig("period", "start") }
                           .select { |start| LocalDate.of(start) == perform_date.to_s }
        LocalDate.time_of(starts.min)
      end

      def patient_number!(patient_fhir_id)
        patient = store.read("Patient", patient_fhir_id)
        number = PatientResource.number_of(patient)
        raise NotFound, "患者番号が登録されていません" if number.blank?

        number
      end

      def record(action, result, **fields)
        log.write(direction: :out, action: action, outcome: result.outcome,
                  code: result.code, message: result.message,
                  warnings: result.warnings.presence, skipped: result.skipped.presence,
                  **fields)
      end

      def item_json(item)
        {
          category: item.category.to_s,
          name: item.name,
          class_code: item.class_code,
          class_name: item.class_name,
          count: item.count,
          days: item.days,
          usage_name: item.usage_name,
          performed_at: item.performed_at,
          lines: item.lines.map do |l|
            { code: l.code, name: l.name, quantity: l.quantity, unit: l.unit, kind: l.kind.to_s,
              section: l.section }.compact
          end
        }.compact
      end

      def diagnosis_json(diagnosis)
        {
          name: diagnosis.name,
          sendable: diagnosis.codes.any?,
          suspected: diagnosis.suspected,
          start_date: diagnosis.start_date,
          end_date: diagnosis.end_date
        }
      end
    end
  end
end
