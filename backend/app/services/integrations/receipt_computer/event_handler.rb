module Integrations
  module ReceiptComputer
    # レセコンから届いた通知を処理する。
    #
    # 通知は「何かが変わった」としか言わないので、中身は必ずレセコンから取り直す。
    # 取りこぼした通知があっても、次の通知か手動の再取込で必ず追いつく。
    #
    # 同じ患者の通知が同時に走ると条件付き作成が二重に成立して、以後その
    # identifier では更新できなくなる。患者番号で直列化してそれを避ける。
    class EventHandler
      TYPES = %w[
        patient.changed patient.deleted
        reception.created reception.updated reception.canceled
      ].freeze

      def initialize(adapter: nil, store: FhirStore.new, log: ReceiptComputer.log)
        @adapter = adapter
        @store = store
        @log = log
      end

      def call(payload)
        type = payload["type"].to_s
        patient_number = payload["patient_number"].to_s
        raise ArgumentError, "type が不正です: #{type}" unless TYPES.include?(type)
        raise ArgumentError, "patient_number がありません" if patient_number.blank?

        with_patient_lock(patient_number) do
          started = Time.current
          result = dispatch(type, patient_number, payload)
          log.write(direction: :in, action: type, outcome: "succeeded",
                    event_id: payload["event_id"], patient_number: patient_number,
                    duration_ms: ((Time.current - started) * 1000).round, **result)
          result
        end
      rescue StandardError => e
        log.write(direction: :in, action: payload["type"], outcome: "failed",
                  event_id: payload["event_id"], patient_number: payload["patient_number"],
                  code: e.class.name, message: e.message)
        raise
      end

      # 患者 1 人ぶんをレセコンから取り直してカルテへ揃える。
      # 通知経由でも手動の再取込でも同じ道を通す。
      def import_patient(patient_number)
        snapshot = adapter.fetch_patient(patient_number)
        patient = PatientImporter.new(store: store).call(snapshot.patient)
        counts = CoverageImporter.new(store: store).call(snapshot, patient_fhir_id: patient["id"])

        { patient_fhir_id: patient["id"], coverages: counts[:imported], cancelled: counts[:cancelled] }
      end

      private

      attr_reader :store, :log

      def adapter = @adapter ||= ReceiptComputer.adapter!

      def dispatch(type, patient_number, payload)
        case type
        when "patient.changed"
          import_patient(patient_number)
        when "patient.deleted"
          patient = PatientImporter.new(store: store).deactivate(patient_number)
          { patient_fhir_id: patient&.dig("id") }
        else
          handle_reception(type, patient_number, payload)
        end
      end

      def handle_reception(type, patient_number, payload)
        event = reception_event(type, patient_number, payload)
        importer = ReceptionImporter.new(store: store, mapper: mapper, log: log)

        if event.action == :canceled
          appointment = importer.call(event, patient_fhir_id: nil)
          return { appointment_fhir_id: appointment&.dig("id") }
        end

        # 受付が先に届くこともあるので、患者が未取込ならここで取り込む。
        patient_fhir_id = PatientImporter.new(store: store).find(patient_number)&.dig("id")
        patient_fhir_id ||= import_patient(patient_number)[:patient_fhir_id]

        appointment = importer.call(event, patient_fhir_id: patient_fhir_id)
        { patient_fhir_id: patient_fhir_id, appointment_fhir_id: appointment&.dig("id") }
      end

      def reception_event(type, patient_number, payload)
        reception = payload["reception"] || {}
        Records::ReceptionEvent.new(
          event_id: payload["event_id"],
          action: type.split(".").last.to_sym,
          reception_key: reception["key"].presence || payload["reception_key"],
          patient_number: patient_number,
          date: reception["date"],
          time: reception["time"],
          department_code: reception["department_code"],
          physician_code: reception["physician_code"],
          coverage_set_key: reception["coverage_set_key"]
        ).tap do |event|
          raise ArgumentError, "reception.key がありません" if event.reception_key.blank?
        end
      end

      def mapper
        @mapper ||= CodeMapper.new(adapter.system_type, adapter.code_kinds)
      end

      # 同じ患者の通知を直列化する。トランザクションの終わりで自動的に解放される。
      def with_patient_lock(patient_number)
        ApplicationRecord.transaction do
          ApplicationRecord.connection.execute(
            ApplicationRecord.sanitize_sql_array(
              ["SELECT pg_advisory_xact_lock(hashtext(?))", "receipt:#{patient_number}"]
            )
          )
          yield
        end
      end
    end
  end
end
