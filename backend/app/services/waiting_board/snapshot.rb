module WaitingBoard
  # 表示板に出す「いま」の値。当日の受付(Appointment)とその診察(外来 Encounter)を上流から読み、
  # 診察室ごとに 呼出中の番号・待ち人数・離席中の人数・本日の平均待ち時間 にまとめる。
  #
  # 患者を特定できるものは何も返さない(患者の _include もしない)。番号は Appointment.identifier
  # (RECEPTION_NUMBER_IDENTIFIER_SYSTEM)だけを見る。
  class Snapshot
    OUTPATIENT_ROOM_TYPE_CODE = "OF".freeze
    DISPLAY_ORDER_EXT_URL = "http://fhir-client.local/StructureDefinition/location-display-order".freeze
    CHECKED_IN_AT_URL = "http://fhir-client.local/StructureDefinition/appointment-checked-in-at".freeze
    # 表示板に載る受付の status。診察中・一時終了でも予約は checked-in のまま、診察終了で fulfilled。
    STATUSES = %w[checked-in fulfilled].freeze

    Entry = Struct.new(:appointment, :encounter, keyword_init: true) do
      def number
        Array(appointment["identifier"]).find { |i| i["system"] == RECEPTION_NUMBER_IDENTIFIER_SYSTEM }&.dig("value").presence
      end

      def encounter_status = encounter&.dig("status")
      def waiting? = encounter.nil? && appointment["status"] == "checked-in"
      def calling? = encounter_status == "in-progress"
      def away? = encounter_status == "onleave"

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

      # 受付から診察開始までの分。どちらかが無ければ nil。
      def wait_minutes
        checked_in = Array(appointment["extension"]).find { |e| e["url"] == CHECKED_IN_AT_URL }&.dig("valueDateTime")
        started = encounter&.dig("period", "start")
        return nil if checked_in.blank? || started.blank?

        ((Time.iso8601(started) - Time.iso8601(checked_in)) / 60).round.clamp(0, nil)
      rescue ArgumentError
        nil
      end
    end

    def initialize(link, store: Integrations::FhirStore.new, today: FacilityClock.today)
      @link = link
      @store = store
      @today = today
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

      { generated_at: Time.current.iso8601, rooms: room_groups, departments: departments }
    end

    private

    def group(entries)
      waits = entries.filter_map(&:wait_minutes)
      {
        calling: entries.select(&:calling?).filter_map(&:number).sort_by { |n| [n.to_i, n] },
        waiting: entries.count(&:waiting?),
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
      appointments.map { |a| Entry.new(appointment: a, encounter: encounters[a["id"]]) }
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
