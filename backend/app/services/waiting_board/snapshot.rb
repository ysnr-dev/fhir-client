module WaitingBoard
  # 表示板に出す「いま」の値。当日の受付(Appointment)とその診察(外来 Encounter)を上流から読み、
  # 診察室ごとに 呼出中の番号(最後に呼んだ 1 人)・待っている受付(受付番号・予約時間・受付時刻)・離席中の人数・本日の平均待ち時間 にまとめる。
  #
  # 患者を特定できるものは何も返さない(患者の _include もしない)。番号は Appointment.identifier
  # (RECEPTION_NUMBER_IDENTIFIER_SYSTEM)だけを見る。
  class Snapshot
    OUTPATIENT_ROOM_TYPE_CODE = "OF".freeze
    DISPLAY_ORDER_EXT_URL = "http://fhir-client.local/StructureDefinition/location-display-order".freeze
    CHECKED_IN_AT_URL = "http://fhir-client.local/StructureDefinition/appointment-checked-in-at".freeze
    # 診察開始の確認で「呼出なし」を選んだ診察の印(frontend の OUTPATIENT_BOARD_CALL_EXTENSION_URL)。
    BOARD_CALL_URL = "http://fhir-client.local/StructureDefinition/outpatient-board-call".freeze
    # カルテの「患者呼出」で呼び出した時刻(frontend の APPOINTMENT_BOARD_CALLED_AT_EXTENSION_URL)。
    CALLED_AT_URL = "http://fhir-client.local/StructureDefinition/appointment-board-called-at".freeze
    # 「患者呼出」の番号を「お呼び出し中」に出しておく時間。
    CALL_DISPLAY_MINUTES = 10
    # 表示板に載る受付の status。診察中・一時終了でも予約は checked-in のまま、診察終了で fulfilled。
    STATUSES = %w[checked-in fulfilled].freeze

    Entry = Struct.new(:appointment, :encounter, :now, keyword_init: true) do
      def number
        Array(appointment["identifier"]).find { |i| i["system"] == RECEPTION_NUMBER_IDENTIFIER_SYSTEM }&.dig("value").presence
      end

      def encounter_status = encounter&.dig("status")
      def waiting? = encounter.nil? && appointment["status"] == "checked-in" && !calling?
      # 診察中で呼出なしを選んでいないもの(印の無い診察は呼び出したものとして扱う)と、「患者呼出」で呼び出したばかりのもの。
      def calling? = called_by_exam_start? || called_recently?
      def called_by_exam_start? = encounter_status == "in-progress" && board_call?

      # 呼び出した時刻(診察開始と「患者呼出」の新しい方)。区画の「お呼び出し中」はこれが一番新しい 1 人。
      def call_time
        times = []
        times << parse_time(encounter.dig("period", "start")) if called_by_exam_start?
        times << parse_time(called_at) if called_recently?
        times.compact.max
      end

      def board_call?
        Array(encounter&.dig("extension")).find { |e| e["url"] == BOARD_CALL_URL }&.dig("valueBoolean") != false
      end
      def away? = encounter_status == "onleave" && !calling?

      # 「患者呼出」から CALL_DISPLAY_MINUTES 以内。診察開始より前の呼出は、診察開始の呼出の確認に任せる。
      def called_recently?
        return false unless appointment["status"] == "checked-in" && encounter_status != "finished"

        called_time = parse_time(called_at)
        return false if called_time.nil?

        started = parse_time(encounter&.dig("period", "start"))
        return false if started && called_time < started

        called_time >= now - CALL_DISPLAY_MINUTES.minutes
      end

      def called_at
        Array(appointment["extension"]).find { |e| e["url"] == CALLED_AT_URL }&.dig("valueDateTime")
      end

      # 診察室。診察が建っていればその場所(受付内容の変更で動く)、無ければ受付の診察室。
      def room_id
        from_encounter = encounter&.dig("location", 0, "location", "reference")
        reference = from_encounter.presence || Array(appointment["participant"])
          .map { |p| p.dig("actor", "reference").to_s }.find { |r| r.start_with?("Location/") }
        reference&.delete_prefix("Location/").presence
      end

      def department
        coding = appointment.dig("specialty", 0, "coding", 0)
        return nil if coding.nil? || coding["code"].blank?

        { code: coding["code"], name: coding["display"].presence || appointment.dig("specialty", 0, "text").presence || coding["code"] }
      end

      def checked_in_at
        Array(appointment["extension"]).find { |e| e["url"] == CHECKED_IN_AT_URL }&.dig("valueDateTime")
      end

      # 当日受付は枠を持たず、start は受付時刻から起こした名目の時間なので予約時間として出さない。
      def walk_in?
        Array(appointment.dig("appointmentType", "coding")).any? { |c| c["code"] == "WALKIN" }
      end

      # 待っている受付の 1 行。番号と時刻だけで、患者を特定できるものは入れない。
      def waiting_row
        {
          number: number,
          booked_time: walk_in? ? nil : clock(appointment["start"]),
          checked_in_time: clock(checked_in_at)
        }
      end

      # 受付から診察開始までの分。どちらかが無ければ nil。
      def wait_minutes
        checked_in = checked_in_at
        started = encounter&.dig("period", "start")
        return nil if checked_in.blank? || started.blank?

        ((Time.iso8601(started) - Time.iso8601(checked_in)) / 60).round.clamp(0, nil)
      rescue ArgumentError
        nil
      end

      private

      def parse_time(value)
        value.present? ? Time.iso8601(value) : nil
      rescue ArgumentError
        nil
      end

      # 「09:30」(日本時間)。
      def clock(value)
        return nil if value.blank? || value.length <= 10

        Time.iso8601(value).in_time_zone(FacilityClock::ZONE).strftime("%H:%M")
      rescue ArgumentError
        nil
      end
    end

    def initialize(link, store: Integrations::FhirStore.new, today: FacilityClock.today, now: Time.current)
      @link = link
      @store = store
      @today = today
      @now = now
    end

    def call
      entries = load_entries
      rooms = room_locations
      only = @link.location_ids
      rooms = rooms.select { |room| only.include?(room["id"]) } if only.any?

      by_room = entries.group_by(&:room_id)
      room_groups = rooms.map do |room|
        group(by_room[room["id"]] || []).merge(id: room["id"], name: room["name"].to_s)
      end

      # 診察室の無い受付は診療科でまとめる。特定の診察室だけを出すリンクでは出さない。
      departments = []
      if only.empty?
        departments = (by_room[nil] || []).group_by(&:department).filter_map do |department, list|
          next nil if department.nil?

          group(list).merge(code: department[:code], name: department[:name])
        end
        departments.sort_by! { |d| d[:code] }
      end

      { generated_at: @now.iso8601, rooms: room_groups, departments: departments }
    end

    private

    def group(entries)
      waits = entries.filter_map(&:wait_minutes)
      {
        # 1 区画に 1 人。前の人は次を呼んだ時点で消える(呼出中のまま待ち・離席中には戻らない)。
        calling: entries.select(&:calling?).max_by { |e| e.call_time || Time.at(0) }&.number,
        waiting: entries.count(&:waiting?),
        # 外来一覧と同じく予約時間(当日受付は受付時刻から起こした start)の順。
        waiting_list: entries.select(&:waiting?).sort_by { |e| e.appointment["start"].to_s }.map(&:waiting_row),
        away: entries.count(&:away?),
        average_wait_minutes: waits.empty? ? nil : (waits.sum.to_f / waits.size).round
      }
    end

    def load_entries
      resources = @store.search(
        "Appointment",
        { "date" => @today.iso8601, "status" => STATUSES.join(","), "_revinclude" => "Encounter:appointment", "_count" => "500" }
      )
      appointments = resources.select { |r| r["resourceType"] == "Appointment" }
                              .select { |r| STATUSES.include?(r["status"]) && Array(r["basedOn"]).empty? }
      encounters = latest_encounter_by_appointment(resources.select { |r| r["resourceType"] == "Encounter" })
      appointments.map { |a| Entry.new(appointment: a, encounter: encounters[a["id"]], now: @now) }
    end

    # 予約ごとの診察。取り消した診察開始(entered-in-error)は除き、開始の新しいものを採る(frontend の latestExamByAppointment と同じ)。
    def latest_encounter_by_appointment(encounters)
      encounters.reject { |e| e["status"] == "entered-in-error" }.each_with_object({}) do |encounter, map|
        id = Array(encounter["appointment"]).map { |a| a["reference"].to_s }.find { |r| r.start_with?("Appointment/") }
                                            &.delete_prefix("Appointment/")
        next if id.blank?

        current = map[id]
        map[id] = encounter if current.nil? || newer?(encounter, current)
      end
    end

    def newer?(a, b)
      key = ->(e) { [e.dig("period", "start").to_s, e.dig("meta", "lastUpdated").to_s] }
      (key.call(a) <=> key.call(b)).positive?
    end

    # 外来の診察室。表示順の拡張 → 名前 の順(frontend の sortLocations と同じ)。
    def room_locations
      @store.search("Location", { "type" => OUTPATIENT_ROOM_TYPE_CODE, "status" => "active", "_count" => "100" })
            .select { |r| r["resourceType"] == "Location" }
            .sort_by { |room| [display_order(room) || Float::INFINITY, room["name"].to_s] }
    end

    def display_order(room)
      Array(room["extension"]).find { |e| e["url"] == DISPLAY_ORDER_EXT_URL }&.dig("valueInteger")
    end
  end
end
