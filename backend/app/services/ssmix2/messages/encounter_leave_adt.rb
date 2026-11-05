module Ssmix2
  module Messages
    # 外出泊。外出泊実施(ADT^A21 / 取消 A52、データ種別 ADT-31)と外出泊帰院実施(ADT^A22 / 取消 A53、ADT-32)。
    # 外出泊は入院の Encounter のローカル拡張(encounter-leave。子拡張 id / start / end / reason)で、1 回ごとに 1 件。
    # 前の版と外出泊ごとに突き合わせ、付いた・変わった外出泊は A21、消えた外出泊は A52 を起こす。
    # 終了(end)は登録時には予定帰院日時(PV2-47)で、帰院の操作で実際に戻った日時に置き換わる。予定と実際を
    # 区別する印は無いので、終了が書き込みの時点より前(帰院済み)になったら A22、帰院済みの終了が消えるか
    # 未来に戻ったら A53 とする。1 回の書き込みで複数の外出泊が動くことがあるので、事象ごとに別のメッセージ
    # (ファイル)にして配列で返す。
    class EncounterLeaveAdt < Base
      Leave = Struct.new(:id, :start, :end_at, :reason, keyword_init: true)
      Event = Struct.new(:code, :structure, :data_kind, :process, :at, :leave, keyword_init: true)

      def build
        encounter = written.resource
        return nil if encounter.nil? || !inpatient?(encounter) || !%w[in-progress finished].include?(encounter["status"])

        previous = previous_version("Encounter", encounter)
        return nil if previous&.dig("status") == "planned"

        events = leave_events(leaves_of(encounter), leaves_of(previous))
        return nil if events.empty?

        patient = patient_of(encounter.dig("subject", "reference"))
        events.map { |event| Message.new(context: context, transaction: transaction, written: written, event: event).build_for(encounter, patient) }
      end

      private

      def leaves_of(encounter)
        Array(encounter&.dig("extension")).select { |e| e["url"] == Fhir::LEAVE_EXT_URL }.map do |e|
          Leave.new(id: Fhir.extension_child(e, "id").to_s, start: Fhir.extension_child(e, "start"),
                    end_at: Fhir.extension_child(e, "end"), reason: Fhir.extension_child(e, "reason"))
        end
      end

      # 外出泊の突き合わせは id で行う。id を持たない外出泊(採番前に書かれたもの)は開始日時で引き当てる。
      def leave_events(current, before)
        events = []
        matched = []
        current.each do |leave|
          old = before.find { |b| same_leave?(b, leave) && !matched.include?(b) }
          matched << old if old
          leave = Leave.new(**leave.to_h, id: leave.id.presence || old&.id.presence || "start-#{leave.start}")
          events << event("A21", "ADT_A21", "ADT-31", "INS", leave.start, leave) if old.nil? || old.start != leave.start || old.reason != leave.reason
          if returned?(leave) && (old.nil? || old.end_at != leave.end_at)
            events << event("A22", "ADT_A21", "ADT-32", "INS", leave.end_at, leave)
          elsif !returned?(leave) && old && returned?(old)
            events << event("A53", "ADT_A52", "ADT-32", "DEL", old.end_at, Leave.new(**leave.to_h, end_at: old.end_at))
          end
        end
        (before - matched).each do |old|
          old = Leave.new(**old.to_h, id: old.id.presence || "start-#{old.start}")
          events << event("A52", "ADT_A52", "ADT-31", "DEL", old.start, old)
          events << event("A53", "ADT_A52", "ADT-32", "DEL", old.end_at, old) if returned?(old)
        end
        events
      end

      # 帰院済みか。終了が書き込みの時点(transaction の記録日時)以前なら、予定ではなく実際に戻った日時。
      def returned?(leave)
        at = Hl7::Stamp.coerce(leave.end_at)
        return false if at.nil?

        at = at.in_time_zone(Hl7::Stamp::ZONE).end_of_day if at.is_a?(Date)
        at <= transaction.occurred_at
      end

      def same_leave?(a, b)
        return a.id == b.id if a.id.present? && b.id.present?

        a.start == b.start
      end

      def event(code, structure, data_kind, process, at, leave)
        Event.new(code: code, structure: structure, data_kind: data_kind, process: process, at: at, leave: leave)
      end

      # 事象 1 件のメッセージ。EVN-3 予定日時(外出は開始、帰院は終了)と EVN-6 実際の日時、PV2-47 予定帰院日時。
      # オーダ No は外出泊ごと・事象ごとに採番し、取消は取り消す事象と同じ番号にする(同日に複数回の外出泊があり得る)。
      class Message < Base
        def initialize(event:, **rest)
          super(**rest)
          @event = event
        end

        def build_for(encounter, patient)
          leave = @event.leave
          kind = @event.data_kind == "ADT-31" ? "A21" : "A22"
          msh("ADT^#{@event.code}^#{@event.structure}")
          builder.add("EVN", "", Hl7::Stamp.format(transaction.occurred_at), Hl7::Stamp.format(@event.at), "", actor_xcn,
                      Hl7::Stamp.format(@event.at), Hl7::Types.text(Settings.facility_id))
          pid(patient)
          pv1(patient, encounter: encounter)
          pv2(47 => Hl7::Stamp.format(leave.end_at))
          result(data_kind: @event.data_kind, service_date: Hl7::Stamp.day(@event.at).presence || UNDATED,
                 order_no: OrderNumber.for("Encounter/#{encounter['id']}##{kind}@#{leave.id}"),
                 process: @event.process, department_code: department_code_of(encounter.dig("serviceProvider", "reference")))
        end
      end
    end
  end
end
