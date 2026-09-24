module LabImport
  # HL7 v2.5 の検査結果メッセージ(JAHIS 臨床検査データ交換規約)を中間表現にする。
  #
  # ファイル転送型で使うのは ORU^R01(規約 §5.3.2)だが、会話型の OUL^R22 も
  # 受け取れるようにしている。両者の違いは SPM が群の頭に来るか尻に来るかだけで、
  #
  #   ORU^R01 : ORC → OBR → [NTE] → OBX{ → NTE} → [SPM]
  #   OUL^R22 : SPM → [SAC] → OBR → ORC → [NTE] → OBX{ → NTE}
  #
  # 「SPM を見たら次の群のために取っておき、群が開くときに渡す」「群が開いている
  # ところに来た SPM はその群に付ける」の 2 つで同じ状態機械に収まる。
  class Hl7Parser
    # 結果に関係しないセグメント。読み飛ばすが、直前の NTE の帰属先は変えない。
    IGNORED = %w[SFT PD1 NK1 AL1 IN1 SAC TQ1 TQ2 CTD FT1 CTI DSC ERR MSA EVN ROL].freeze
    # OBX-11。X(結果が得られない)と D(削除)の行は取り込まない。
    SKIPPED_STATUSES = %w[X D].freeze

    def initialize(text)
      @text = text
    end

    def parse
      reset
      Hl7Tokenizer.segments(@text).each { |segment| dispatch(segment) }
      flush_report
      raise ImportError, "MSH セグメントがありません" if @message.nil?

      @message
    end

    # 読み飛ばした OBX の数(X / D)。Importer が取込バッチに残す。
    attr_reader :skipped_count

    private

    def reset
      @message = nil
      @patient = nil
      @report = nil
      @scoped_specimens = []
      @anchor = :other
      # OUL は SPM が群の頭に来る。MSH-9 が読めない場合は ORU 相当にする。
      @spm_opens_group = false
      @specimen_scope = false
      @orc_seen = false
      @obr_seen = false
      @skipped_count = 0
    end

    def dispatch(segment)
      case segment.name
      when "MSH" then on_msh(segment)
      when "PID" then on_pid(segment)
      when "PV1" then on_pv1(segment)
      when "SPM" then on_spm(segment)
      when "ORC" then on_orc(segment)
      when "OBR" then on_obr(segment)
      when "OBX" then on_obx(segment)
      when "NTE" then on_nte(segment)
      else
        nil unless IGNORED.include?(segment.name)
      end
    end

    # --- セグメントごとの処理 -------------------------------------------------

    def on_msh(segment)
      flush_report
      @patient = nil
      @scoped_specimens = []
      @specimen_scope = false
      message_type = [segment.component(9, 1), segment.component(9, 2)].reject(&:empty?).join("^")
      @spm_opens_group = segment.component(9, 1).upcase == "OUL"
      @message = Message::Root.new(
        # 取込元は送信施設(MSH-4)。無ければ送信アプリケーション(MSH-3)。
        source: segment.component(4, 1).presence || segment.component(3, 1).presence,
        message_type: message_type.presence,
        control_id: segment.field(10).presence,
        sent_at: Hl7Time.parse(segment.field(7)),
        charset: segment.field(18).presence,
        reports: []
      )
      @anchor = :other
    end

    def on_pid(segment)
      flush_report
      @scoped_specimens = []
      @specimen_scope = false
      @patient = Message::Patient.new(
        number: segment.component(3, 1).presence,
        name: patient_name(segment),
        birth_date: Hl7Time.parse_date(segment.field(7)),
        sex: segment.field(8).presence
      )
      @anchor = :other
    end

    # PID-5 は「姓^名」。繰り返しの先頭(漢字表記)だけを使う。
    def patient_name(segment)
      parts = [segment.component(5, 1), segment.component(5, 2)].reject(&:empty?)
      parts.empty? ? nil : parts.join("　")
    end

    def on_pv1(segment)
      return if @patient.nil?

      @patient.setting = case segment.field(2).upcase
                         when "I" then "inpatient"
                         when "O" then "outpatient"
                         end
    end

    def on_spm(segment)
      specimen = Message::Specimen.new(
        ids: specimen_ids(segment),
        material_code: segment.component(4, 1).presence,
        material_name: segment.component(4, 2).presence,
        collected_at: Hl7Time.parse(segment.field(17))
      )

      if @spm_opens_group || @report.nil?
        # 群の頭に来た検体。次に開く群(と、その検体に続く複数の OBR)に渡す。
        flush_report
        @scoped_specimens = @specimen_scope ? @scoped_specimens + [specimen] : [specimen]
      else
        # 群の尻に来た検体(ORU)。その群に直接付ける。
        @report.specimens << specimen
      end
      @specimen_scope = true
      @anchor = :other
    end

    # SPM-2 は「検体 ID^実施者検体 ID」で繰り返しうる。台帳ではどれがラベル番号か
    # 分からないので、全部を候補として持つ。
    def specimen_ids(segment)
      ids = []
      segment.repetition_count(2).times do |rep|
        ids << segment.subcomponent(2, 1, 1, rep: rep)
        ids << segment.subcomponent(2, 2, 1, rep: rep)
      end
      ids.map(&:presence).compact.uniq
    end

    def on_orc(segment)
      # OUL は OBR の後に ORC が来る。群が開いていて ORC がまだなら同じ群に足す。
      start_report unless @report && !@orc_seen
      @orc_seen = true
      @specimen_scope = false
      @report.placer_order_number ||= segment.field(2).presence
      @report.filler_order_number ||= segment.field(3).presence
      @anchor = :report
    end

    def on_obr(segment)
      # ORC が先に開いた群なら同じ群に入れる。OBR が既にある(1 ORC に OBR 複数、
      # または OUL の SPM → OBR)なら新しい群にする。
      start_report if @report.nil? || @obr_seen
      @obr_seen = true
      @specimen_scope = false
      @report.placer_order_number = segment.field(2).presence || @report.placer_order_number
      @report.filler_order_number = segment.field(3).presence || @report.filler_order_number
      @report.code = segment.component(4, 1).presence
      @report.code_name = segment.component(4, 2).presence
      @report.collected_at = Hl7Time.parse(segment.field(7)) || @report.collected_at
      @report.reported_at = Hl7Time.parse(segment.field(22))
      @report.status = segment.field(25).presence
      @anchor = :report
    end

    def on_obx(segment)
      # SPM 直下の OBX は検体の状態(溶血・乳びなど)で結果ではない。
      return if @specimen_scope

      start_report if @report.nil?
      status = segment.field(11).presence
      if SKIPPED_STATUSES.include?(status.to_s.upcase)
        @skipped_count += 1
        @anchor = :other
        return
      end

      @report.observations << build_observation(segment, status)
      @anchor = :observation
    end

    def build_observation(segment, status)
      value_type = segment.field(2).presence
      code, name, system = identifier_of(segment)
      value, value_text, value_code_system = value_of(segment, value_type)
      jlac10, jlac11 = jlac_of(segment)

      Message::Observation.new(
        set_id: segment.field(1).presence,
        value_type: value_type,
        code: code, name: name, code_system: system,
        jlac10: jlac10, jlac11: jlac11,
        value: value, value_text: value_text, value_code_system: value_code_system,
        unit: segment.component(6, 2).presence || segment.component(6, 1).presence,
        reference_range: segment.field(7).presence,
        abnormal_flag: segment.field(8).presence,
        status: status,
        observed_at: Hl7Time.parse(segment.field(14)),
        notes: []
      )
    end

    # OBX-3 は「コード^名称^体系」(成分 4〜6 は代替コード)。台帳が持つ外部コードは主の方。
    def identifier_of(segment)
      code = segment.component(3, 1).presence || segment.component(3, 4).presence
      name = segment.component(3, 2).presence || segment.component(3, 5).presence
      system = segment.component(3, 3).presence || segment.component(3, 6).presence
      [code, name, system]
    end

    # JLAC の取り出し。体系名が JC10 / JLAC10 なら JLAC10、JC11 / JLAC11 なら JLAC11。
    # 体系名が空で 17 桁の数字のときは、どちらの体系か決められないので両方の候補に
    # 入れる(結果項目マスタの jlac10_code / jlac11_code の双方に当てて引き当てる)。
    def jlac_of(segment)
      jlac10 = nil
      jlac11 = nil
      [[1, 3], [4, 6]].each do |code_index, system_index|
        code = segment.component(3, code_index).presence
        next if code.nil?

        system = segment.component(3, system_index).to_s.upcase
        case system
        when "JC10", "JLAC10" then jlac10 ||= code
        when "JC11", "JLAC11" then jlac11 ||= code
        when ""
          # 体系名を付けない装置がある。JLAC の桁数(17 桁の英数字)に合う場合だけ
          # 候補にし、どちらの体系か決められないので両方に入れる。
          next unless code.match?(/\A[0-9A-Za-z]{17}\z/)

          jlac10 ||= code
          jlac11 ||= code
        end
      end
      [jlac10, jlac11]
    end

    # OBX-5。値型ごとに読み方が違う(SN は「比較子 数値 区切り 数値」の構造化数値)。
    def value_of(segment, value_type)
      case value_type.to_s.upcase
      when "TX"
        [joined_repetitions(segment, 5), nil, nil]
      when "SN"
        parts = (1..4).map { |i| segment.component(5, i) }
        [parts.join.strip.presence, nil, nil]
      when "CE", "CWE", "CF", "CNE"
        [segment.component(5, 1).presence, segment.component(5, 2).presence,
         segment.component(5, 3).presence]
      else
        [segment.component(5, 1).presence, nil, nil]
      end
    end

    def joined_repetitions(segment, index)
      values = Array.new(segment.repetition_count(index)) { |rep| segment.text(index, rep: rep) }
      values.reject(&:empty?).join("\n").presence
    end

    def on_nte(segment)
      comment = joined_repetitions(segment, 3)
      return if comment.nil?

      case @anchor
      when :observation then @report.observations.last.notes << comment
      when :report then @report.comments << comment
      end
    end

    # --- 群の開始と確定 -------------------------------------------------------

    def start_report
      flush_report
      @report = Message::Report.start(@patient, @scoped_specimens.dup)
      @orc_seen = false
      @obr_seen = false
    end

    def flush_report
      return if @report.nil?

      @message.reports << @report if @message
      @report = nil
      @orc_seen = false
      @obr_seen = false
    end
  end
end
