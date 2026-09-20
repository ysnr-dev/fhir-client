module Integrations
  module ReceiptComputer
    # レセコンの受付をカルテの Appointment へ取り込む。
    #
    # 作るのは Appointment だけ。Encounter は診察を始めたときにカルテ側で作る
    # (受付 = 診察開始ではないので、ここで作ると全員が受診済みに見える)。
    # 形は当日受付(frontend の buildWalkInAppointment)と同じにする。
    class ReceptionImporter
      APPOINTMENT_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0276".freeze
      CHECKED_IN_AT_URL = "http://fhir-client.local/StructureDefinition/appointment-checked-in-at".freeze
      SSMIX2_DEPARTMENT_SYSTEM = "http://fhir-client.local/CodeSystem/ssmix2-department-code".freeze
      WALK_IN_MINUTES = 15
      # レセコンが返す受付時刻は診療所の壁時計の時刻。アプリは UTC で動いているので、
      # ここで診療所の時間帯に当てないと 9 時間ずれた受付になる。
      CLINIC_ZONE = ActiveSupport::TimeZone["Asia/Tokyo"].freeze

      def initialize(store: FhirStore.new, mapper:, log: nil)
        @store = store
        @mapper = mapper
        @log = log
      end

      def call(event, patient_fhir_id:)
        case event.action
        when :canceled then cancel(event)
        else upsert(event, patient_fhir_id)
        end
      end

      private

      attr_reader :store, :mapper, :log

      # レセコンが正本なので、受付の内容は毎回そのまま書き直す。差分を追わないぶん、
      # 通知を取りこぼしたあとに流しても必ず追いつく。
      def upsert(event, patient_fhir_id)
        existing = find(event.reception_key)
        appointment = base_appointment(event, patient_fhir_id)

        appointment["id"] = existing["id"] if existing
        appointment["specialty"] = specialty(event)
        appointment["participant"] = participants(event, patient_fhir_id, existing)
        appointment["identifier"] = [identifier(event.reception_key)]
        appointment["extension"] = coverage_set_extension(appointment, event)
        appointment.compact!

        store.conditional_put("Appointment", appointment,
                              { "identifier" => identifier_query(event.reception_key) })
      end

      # 診察が始まっている受付は触らない。レセコン側の取消が先に来ても、
      # カルテに残っている診察の記録を消してしまわないようにする。
      def cancel(event)
        existing = find(event.reception_key)
        return nil if existing.nil?

        if encounter_started?(existing)
          log&.write(direction: :in, action: "reception.canceled", outcome: "skipped",
                     reception_key: event.reception_key,
                     message: "診察が始まっているため取り消しませんでした")
          return nil
        end

        store.put("Appointment", existing["id"], existing.merge("status" => "cancelled"))
      end

      # 上流の Encounter は appointment での検索を持たないので、患者で引いてから
      # 参照を突き合わせる。
      def encounter_started?(appointment)
        patient = Array(appointment["participant"])
                  .filter_map { |p| p.dig("actor", "reference") }
                  .find { |r| r.start_with?("Patient/") }
        return false if patient.nil?

        reference = "Appointment/#{appointment['id']}"
        store.search("Encounter", { "subject" => patient, "_count" => "100" }, limit: 100)
             .any? { |e| Array(e["appointment"]).any? { |a| a["reference"] == reference } }
      end

      def base_appointment(event, patient_fhir_id)
        start = CLINIC_ZONE.parse("#{event.date} #{event.time || '00:00:00'}")
        {
          "resourceType" => "Appointment",
          "status" => "checked-in",
          "appointmentType" => {
            "coding" => [{ "system" => APPOINTMENT_TYPE_SYSTEM, "code" => "WALKIN", "display" => "当日受付" }]
          },
          "description" => "当日受付",
          "start" => start.iso8601,
          "end" => (start + WALK_IN_MINUTES.minutes).iso8601,
          "minutesDuration" => WALK_IN_MINUTES,
          "extension" => [{ "url" => CHECKED_IN_AT_URL, "valueDateTime" => start.iso8601 }]
        }
      end

      def identifier(key)
        { "system" => ReceiptComputer::RECEPTION_IDENTIFIER_SYSTEM, "value" => key }
      end

      def identifier_query(key) = "#{ReceiptComputer::RECEPTION_IDENTIFIER_SYSTEM}|#{key}"

      def find(key)
        store.search("Appointment", { "identifier" => identifier_query(key), "_count" => "2" }, limit: 2).first
      end

      def specialty(event)
        code = mapper.to_local("department", event.department_code)
        return nil if code.blank?

        name = department_name(code)
        [{ "coding" => [{ "system" => SSMIX2_DEPARTMENT_SYSTEM, "code" => code,
                          "display" => name }.compact], "text" => name }.compact]
      end

      # 診療科名はカルテに登録された診療科(Organization)から取る。
      # 未登録の科でも受付は取り込むので、名前が引けなくても止めない。
      def department_name(code)
        @department_names ||= {}
        return @department_names[code] if @department_names.key?(code)

        organization = store.search(
          "Organization",
          { "identifier" => "#{SSMIX2_DEPARTMENT_SYSTEM}|#{code}", "_count" => "1" }, limit: 1
        ).first
        @department_names[code] = organization&.dig("name").presence
      rescue FhirStore::UpstreamError
        nil
      end

      # participant の先頭は必ず患者。医師は対応表で引けたときだけ付ける
      # (対応が無いまま推測で付けると別の医師の予定になる)。
      def participants(event, patient_fhir_id, existing)
        patient = existing_participant(existing, "Patient") ||
                  { "actor" => { "reference" => "Patient/#{patient_fhir_id}" },
                    "required" => "required", "status" => "accepted" }
        list = [patient]

        practitioner_id = mapper.to_local("physician", event.physician_code)
        if practitioner_id.present?
          list << { "actor" => { "reference" => "Practitioner/#{practitioner_id}",
                                 "display" => practitioner_name(practitioner_id) }.compact,
                    "required" => "required", "status" => "accepted" }
        elsif event.physician_code.present?
          log&.write(direction: :in, action: "reception.physician", outcome: "warning",
                     reception_key: event.reception_key, external_code: event.physician_code,
                     message: "医師コードの対応付けがありません")
        end

        # 診察室などカルテ側で付けた参加者は残す。
        Array(existing&.dig("participant")).each do |p|
          reference = p.dig("actor", "reference").to_s
          list << p if reference.start_with?("Location/")
        end
        list
      end

      def existing_participant(existing, type)
        Array(existing&.dig("participant")).find do |p|
          p.dig("actor", "reference").to_s.start_with?("#{type}/")
        end
      end

      def practitioner_name(id)
        resource = store.read_or_nil("Practitioner", id)
        name = Array(resource&.dig("name")).first
        return nil if name.nil?

        name["text"].presence || [name["family"], Array(name["given"]).first].compact_blank.join("　").presence
      end

      # 会計送信の初期値に使う。カルテは中身を解釈せず、そのままレセコンへ返す。
      # ただし全ゼロは「保険組合せを選ばずに受付した」ことを表す番号で、実在する
      # 組合せではない。記録すると会計送信がその番号を返してしまい、レセコン側で
      # 病名も診療行為も保険に結びつかなくなるため落とす。
      def coverage_set_extension(appointment, event)
        rest = Array(appointment["extension"]).reject { |e| e["url"] == ReceiptComputer::RECEPTION_COVERAGE_SET_URL }
        return rest if event.coverage_set_key.blank? || event.coverage_set_key.match?(/\A0+\z/)

        rest + [{ "url" => ReceiptComputer::RECEPTION_COVERAGE_SET_URL,
                  "valueString" => event.coverage_set_key }]
      end
    end
  end
end
