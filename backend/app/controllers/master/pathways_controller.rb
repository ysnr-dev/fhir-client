module Master
  # クリニカルパス(施設パス)定義マスタ(docs/clinical-pathway-design.md)。
  #
  # 本体と子(対象病名・フェーズと分岐・病日・OAT ユニット・観察項目・タスク)を 1 リクエストで
  # 読み書きする。子は配列を丸ごと置換し、display_order は配列順で振り直す(レジメンと
  # 同じ)。OAT ユニット・観察項目・タスクの uuid キーは画面が採り、置換で行を作り直しても
  # 変わらない(適用後データの識別子に使うため)。同じキーを複数の病日に置いたものが
  # 「続き」(日をまたぐアウトカム・継続するタスク)で、一意なのは親(病日・OAT ユニット)の
  # 中だけ。外部キーは張らないので削除は transaction で
  # 片付ける。承認済・廃止は内容を凍結し、直すときは複製する。
  class PathwaysController < BaseController
    include VersionedMaster

    def index
      scope = Master::Pathway.all
      scope = scope.where(department_code: params[:department_code]) if params[:department_code].present?
      scope = scope.where(status: params[:status]) if params[:status].present?
      scope = scope.where(setting: params[:setting]) if params[:setting].present?
      scope = scope.active_on if params[:active] == "true"
      query = params[:name].presence || params[:keyword].presence
      scope = flexible_name_match(scope, query, SEARCH_COLUMNS) if query

      result = paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:pathway_code))
      codes = result[:items].map(&:pathway_code)
      events = Master::PathwayEvent.where(pathway_code: codes).group(:pathway_code)
      # 同じ病日をステップで分けても 1 日と数える。
      counts = events.distinct.count(:elapsed_days)
      last_days = events.maximum(:elapsed_days)
      result[:items] = result[:items].map { |r| summary(r, counts[r.pathway_code].to_i, last_days[r.pathway_code]) }
      render json: result
    end

    private

    PATHWAY_ATTRS = %i[
      pathway_code name short_name name_kana version department_code department_name setting
      scheduled_days adaptive_criteria protocol_base status approved_on approved_by
      valid_from valid_to display_order note copied_from_code
    ].freeze

    INDICATION_ATTRS = %w[management_number name icd10].freeze
    PHASE_ATTRS = %w[phase_key name note].freeze
    BRANCH_ATTRS = %w[to_phase_key criteria].freeze
    EVENT_ATTRS = %w[phase_key elapsed_days path_step path_step_name title allowable_condition_type allowable_days
                     allowable_range_low allowable_range_high note].freeze
    UNIT_ATTRS = %w[unit_key name category code_system code critical note].freeze
    ASSESSMENT_ATTRS = %w[assessment_key name category_code category_name code_system code proper_value
                          nursing_observation_manage_no note].freeze
    TASK_ATTRS = %w[task_key name category_lv1 category_lv2 code order_type order_label order_values
                    order_schema_version note].freeze

    def record_params
      params.permit(*PATHWAY_ATTRS)
    end

    def child_param_keys
      %i[indications phases events]
    end

    def master_label
      "パス"
    end

    def parent_id_columns
      %w[event_id unit_id assessment_id]
    end

    # 子の配列が来た種別だけ置換する(来ていない種別は触らない)。
    def replace_children(record)
      code = record.pathway_code
      if params.key?(:indications)
        Master::PathwayIndication.where(pathway_code: code).delete_all
        rows = []
        each_row(params[:indications]) do |row, index|
          rows << row.slice(*INDICATION_ATTRS).merge("pathway_code" => code, "display_order" => index + 1)
        end
        insert_rows(Master::PathwayIndication, rows)
      end
      replace_phases(code, params[:phases]) if params.key?(:phases)
      return unless params.key?(:events)

      delete_event_tree(code)
      insert_event_tree(code, params[:events], default_phase_key(code))
    end

    # フェーズと、その下の分岐(phases[].branches[])。分岐元は親のフェーズ。
    def replace_phases(code, raw_phases)
      delete_phases(code)
      phase_rows = []
      branch_rows = []
      each_row(raw_phases) do |row, index|
        key = row["phase_key"].presence || SecureRandom.uuid
        phase_rows << row.slice(*PHASE_ATTRS).merge(
          "pathway_code" => code, "display_order" => index + 1, "phase_key" => key,
        )
        each_row(row["branches"]) do |branch_row, branch_index|
          branch_rows << branch_row.slice(*BRANCH_ATTRS).merge(
            "pathway_code" => code, "from_phase_key" => key, "display_order" => branch_index + 1,
            "to_phase_key" => branch_row["to_phase_key"].presence,
          )
        end
      end
      insert_rows(Master::PathwayPhase, phase_rows, unique_by: %w[phase_key], duplicate_on: :phase_key)
      insert_rows(Master::PathwayPhaseBranch, branch_rows)
    end

    # フェーズを指さない病日が入る先(先頭のフェーズ)。フェーズが 1 つも無ければ作る。
    def default_phase_key(code)
      first = Master::PathwayPhase.where(pathway_code: code).in_display_order.first
      first ||= Master::PathwayPhase.create!(pathway_code: code, phase_key: SecureRandom.uuid, display_order: 1)
      first.phase_key
    end

    # 病日 → OAT ユニット → 観察項目 → タスクを、階層ごとに 1 回の INSERT で入れる。
    # タスク→観察項目は assessment_key(uuid)で受け、同じユニットの中で新しい id に引き直す
    # (置換で id が変わるため)。
    def insert_event_tree(code, raw_events, default_phase)
      event_rows = []
      units = [] # [親の病日の添字, ユニットの行, ユニット内の並び]
      each_row(raw_events) do |row, index|
        event_rows << row.slice(*EVENT_ATTRS).merge(
          "pathway_code" => code, "display_order" => index + 1,
          "phase_key" => row["phase_key"].presence || default_phase,
        )
        each_row(row["oat_units"]) { |unit_row, unit_index| units << [index, unit_row, unit_index] }
      end
      event_ids = insert_rows(Master::PathwayEvent, event_rows,
                              unique_by: %w[phase_key elapsed_days path_step], duplicate_on: :elapsed_days)

      unit_rows = units.map do |event_index, row, index|
        row.slice(*UNIT_ATTRS).merge(
          "pathway_code" => code, "event_id" => event_ids[event_index], "display_order" => index + 1,
          "unit_key" => row["unit_key"].presence || SecureRandom.uuid,
        )
      end
      unit_ids = insert_rows(Master::PathwayOatUnit, unit_rows,
                             unique_by: %w[event_id unit_key], duplicate_on: :unit_key)

      assessment_ids = insert_assessments(code, units, unit_ids)
      insert_tasks(code, units, unit_ids, assessment_ids)
    end

    # 観察項目を入れ、[ユニットの id, assessment_key] → 観察項目の id を返す。
    def insert_assessments(code, units, unit_ids)
      rows = []
      units.each_with_index do |(_, unit_row, _), unit_index|
        each_row(unit_row["assessments"]) do |row, index|
          rows << row.slice(*ASSESSMENT_ATTRS).merge(
            "pathway_code" => code, "unit_id" => unit_ids[unit_index], "display_order" => index + 1,
            "assessment_key" => row["assessment_key"].presence || SecureRandom.uuid,
          )
        end
      end
      ids = insert_rows(Master::PathwayAssessment, rows,
                        unique_by: %w[unit_id assessment_key], duplicate_on: :assessment_key)
      rows.zip(ids).to_h { |row, id| [[row["unit_id"], row["assessment_key"]], id] }
    end

    def insert_tasks(code, units, unit_ids, assessment_ids)
      rows = []
      units.each_with_index do |(_, unit_row, _), unit_index|
        unit_id = unit_ids[unit_index]
        each_row(unit_row["tasks"]) do |row, index|
          key = row["assessment_key"].presence
          if key && !assessment_ids.key?([unit_id, key])
            raise ContentInvalid, ["タスク「#{row['name']}」が結ぶ観察項目が同じ OAT ユニットにありません"]
          end

          rows << row.slice(*TASK_ATTRS).merge(
            "pathway_code" => code, "unit_id" => unit_id, "display_order" => index + 1,
            "task_key" => row["task_key"].presence || SecureRandom.uuid,
            "assessment_id" => key && assessment_ids[[unit_id, key]],
            "order_values" => row["order_values"].is_a?(Hash) ? row["order_values"] : {},
          )
        end
      end
      insert_rows(Master::PathwayTask, rows, unique_by: %w[unit_id task_key], duplicate_on: :task_key)
    end

    # フェーズと分岐、病日と、その下の OAT ユニット・観察項目・タスク。保存後の検証と応答の
    # 組み立てで同じものを使い、子テーブルを読むのは 1 回で済ませる。病日はフェーズ順 → 病日順。
    PathwayTree = Struct.new(:phases, :branches_by_phase, :events, :units_by_event, :assessments_by_unit,
                             :tasks_by_unit, keyword_init: true) do
      def events_by_phase
        @events_by_phase ||= events.group_by(&:phase_key)
      end
    end

    def load_tree(pathway)
      code = pathway.pathway_code
      phases = Master::PathwayPhase.where(pathway_code: code).in_display_order.to_a
      phase_order = phases.each_with_index.to_h { |phase, index| [phase.phase_key, index] }
      events = Master::PathwayEvent.where(pathway_code: code).in_day_order.to_a
      PathwayTree.new(
        phases: phases,
        branches_by_phase: Master::PathwayPhaseBranch.where(pathway_code: code).in_display_order
                                                     .group_by(&:from_phase_key),
        events: events.sort_by.with_index { |event, index| [phase_order[event.phase_key] || phases.size, index] },
        units_by_event: Master::PathwayOatUnit.where(pathway_code: code).in_display_order.group_by(&:event_id),
        assessments_by_unit: Master::PathwayAssessment.where(pathway_code: code).in_display_order.group_by(&:unit_id),
        tasks_by_unit: Master::PathwayTask.where(pathway_code: code).in_display_order.group_by(&:unit_id),
      )
    end

    # 画面の validatePathwayDraft は入力中の案内で、API を直に叩けば素通りする。
    # どの入口から来ても効かせたい検証をここに置く。下書きは緩く、承認で厳しくする。
    def validate_content!(record, tree)
      messages = always_invalid_messages(tree)
      messages += approval_invalid_messages(record, tree) if record.status == "approved"
      raise ContentInvalid, messages if messages.any?
    end

    # 下書きでも通さないもの。識別子の重なり(同じ病日・OAT ユニットの中)はモデルの検証で弾く。
    def always_invalid_messages(tree)
      duplicated = tree.events.group_by { |e| [e.phase_key, e.event_key] }.select { |_, v| v.size > 1 }.keys
      messages = duplicated.map { |_, k| "病日 #{k} が重複しています" }
      keys = tree.phases.map(&:phase_key)
      messages << "病日が結ぶフェーズがありません" if tree.events.any? { |e| keys.exclude?(e.phase_key) }
      tree.phases.each do |phase|
        (tree.branches_by_phase[phase.phase_key] || []).each do |branch|
          next if branch.to_phase_key.blank?

          if branch.to_phase_key == phase.phase_key
            messages << "#{phase_label(phase)} の分岐先が同じフェーズです"
          elsif keys.exclude?(branch.to_phase_key)
            messages << "#{phase_label(phase)} の分岐先のフェーズがありません"
          end
        end
      end
      messages
    end

    # 承認するときだけ求める完全性。ここを通ったパスは、患者に適用したときに
    # 病日ごとのアウトカムとタスクを展開できる。
    def approval_invalid_messages(record, tree)
      events = tree.events
      messages = []
      messages << "適応基準がありません" if record.adaptive_criteria.blank?
      messages << "パス予定日数がありません" if record.scheduled_days.blank?
      return messages + ["病日がありません"] if events.empty?

      messages += phase_invalid_messages(tree)
      last_day = standard_last_day(tree)
      if record.scheduled_days.present? && last_day && record.scheduled_days < last_day
        messages << "パス予定日数(#{record.scheduled_days} 日)より後の病日(#{last_day} 日目)があります"
      end
      events.each do |event|
        messages << "#{event_label(event)} に OAT ユニットがありません" if tree.units_by_event[event.id].blank?
      end
      tree.tasks_by_unit.values.flatten.each do |task|
        next unless task.order_template? && task.order_values.blank?

        messages << "タスク「#{task.name}」のオーダー雛形が空です"
      end
      messages
    end

    # フェーズと分岐の完全性。フェーズが 1 つのパスは病日の歯抜けを許す(分岐が無ければ
    # 通しの病日が食い違うことはない)。
    def phase_invalid_messages(tree)
      phases = tree.phases
      messages = []
      phases.each do |phase|
        messages << "#{phase_label(phase)} に病日がありません" if tree.events_by_phase[phase.phase_key].blank?
      end
      return messages if phases.size < 2

      messages << "フェーズ名がありません" if phases.any? { |phase| phase.name.blank? }
      messages << "フェーズの分岐が循環しています" if phase_cycle?(tree)
      reachable = reachable_phase_keys(tree)
      phases.each do |phase|
        messages << "#{phase_label(phase)} に進む分岐がありません" if reachable.exclude?(phase.phase_key)
        days = phase_days(tree, phase.phase_key)
        next if days.empty?

        unless days.each_cons(2).all? { |a, b| b == next_day(a) }
          messages << "#{phase_label(phase)} の病日が連続していません"
        end
        (tree.branches_by_phase[phase.phase_key] || []).each do |branch|
          target_days = phase_days(tree, branch.to_phase_key)
          next if target_days.empty? || target_days.first == next_day(days.last)

          target = phases.find { |p| p.phase_key == branch.to_phase_key }
          messages << "#{phase_label(target)} は病日 #{next_day(days.last)} から始めてください" \
                      "(#{phase_label(phase)} の続き)"
        end
      end
      messages.uniq
    end

    # 標準の経路(各フェーズの分岐の先頭を辿る)の最終病日。
    def standard_last_day(tree)
      phase = tree.phases.first
      return tree.events.map(&:elapsed_days).max unless phase

      seen = []
      last = nil
      while phase && seen.exclude?(phase.phase_key)
        seen << phase.phase_key
        last = phase_days(tree, phase.phase_key).last || last
        to = (tree.branches_by_phase[phase.phase_key] || []).first&.to_phase_key
        phase = to && tree.phases.find { |p| p.phase_key == to }
      end
      last
    end

    def phase_days(tree, phase_key)
      (tree.events_by_phase[phase_key] || []).map(&:elapsed_days).uniq.sort
    end

    # 病日は 0 を使わない(-1 の次は 1)。
    def next_day(day)
      day == -1 ? 1 : day + 1
    end

    def next_phase_keys(tree, phase_key)
      (tree.branches_by_phase[phase_key] || []).filter_map(&:to_phase_key)
    end

    def reachable_phase_keys(tree)
      first = tree.phases.first&.phase_key
      reached = []
      queue = [first].compact
      until queue.empty?
        key = queue.shift
        next if reached.include?(key)

        reached << key
        queue.concat(next_phase_keys(tree, key))
      end
      reached
    end

    def phase_cycle?(tree)
      state = {}
      visit = lambda do |key|
        return true if state[key] == :visiting
        return false if state[key] == :done

        state[key] = :visiting
        found = next_phase_keys(tree, key).any? { |to| visit.call(to) }
        state[key] = :done
        found
      end
      tree.phases.any? { |phase| visit.call(phase.phase_key) }
    end

    def phase_label(phase)
      phase&.name.present? ? "フェーズ「#{phase.name}」" : "フェーズ"
    end

    def event_label(event)
      event.title.presence || "病日 #{event.event_key}"
    end

    # 子を階層ごとにまとめて写す(1 階層 1 回の INSERT)。親の id は写した先の id に付け替える。
    # 行は元の並び(表示順・id 順)で入れるので、表示順が同じ行の前後も元と変わらない。
    def copy_children(source, target)
      to = target.pathway_code
      insert_copies(Master::PathwayIndication, source.indications.to_a, [], to)
      tree = load_tree(source)
      insert_copies(Master::PathwayPhase, tree.phases, [], to)
      insert_copies(Master::PathwayPhaseBranch, tree.branches_by_phase.values.flatten, [], to)
      event_ids = insert_copies(Master::PathwayEvent, tree.events, %w[phase_key elapsed_days path_step], to)

      units = tree.units_by_event.values.flatten.select { |unit| event_ids.key?(unit.event_id) }
      unit_ids = insert_copies(Master::PathwayOatUnit, units, %w[event_id unit_key], to) do |unit|
        { "event_id" => event_ids[unit.event_id] }
      end

      assessments = tree.assessments_by_unit.values.flatten.select { |a| unit_ids.key?(a.unit_id) }
      assessment_ids = insert_copies(Master::PathwayAssessment, assessments, %w[unit_id assessment_key], to) do |a|
        { "unit_id" => unit_ids[a.unit_id] }
      end
      assessment_units = assessments.to_h { |a| [a.id, a.unit_id] }

      tasks = tree.tasks_by_unit.values.flatten.select { |task| unit_ids.key?(task.unit_id) }
      insert_copies(Master::PathwayTask, tasks, [], to) do |task|
        # タスクが結ぶ観察項目は同じ OAT ユニットのものだけ(置換時の検証と同じ)。
        linked = task.assessment_id && assessment_units[task.assessment_id] == task.unit_id
        { "unit_id" => unit_ids[task.unit_id], "assessment_id" => linked ? assessment_ids[task.assessment_id] : nil }
      end
    end

    def delete_event_tree(code)
      Master::PathwayTask.where(pathway_code: code).delete_all
      Master::PathwayAssessment.where(pathway_code: code).delete_all
      Master::PathwayOatUnit.where(pathway_code: code).delete_all
      Master::PathwayEvent.where(pathway_code: code).delete_all
    end

    def delete_phases(code)
      Master::PathwayPhaseBranch.where(pathway_code: code).delete_all
      Master::PathwayPhase.where(pathway_code: code).delete_all
    end

    def delete_children(code)
      delete_event_tree(code)
      delete_phases(code)
      Master::PathwayIndication.where(pathway_code: code).delete_all
    end

    def summary(pathway, event_count = nil, last_day = nil)
      pathway.as_json(except: %w[search_name search_kana search_short_name])
             .merge("event_count" => event_count, "last_day" => last_day)
    end

    # 詳細は子を入れ子で同梱し、画面が 1 リクエストで開けるようにする。
    def detail(pathway, tree = load_tree(pathway))
      events = tree.events
      units_by_event = tree.units_by_event
      assessments_by_unit = tree.assessments_by_unit
      tasks_by_unit = tree.tasks_by_unit
      summary(pathway, events.map(&:elapsed_days).uniq.size, events.map(&:elapsed_days).max).merge(
        "indications" => pathway.indications.as_json,
        "phases" => tree.phases.map do |phase|
          phase.as_json.merge("branches" => (tree.branches_by_phase[phase.phase_key] || []).as_json)
        end,
        "events" => events.map do |event|
          event.as_json.merge(
            "event_key" => event.event_key,
            "oat_units" => (units_by_event[event.id] || []).map do |unit|
              assessments = assessments_by_unit[unit.id] || []
              keys = assessments.to_h { |a| [a.id, a.assessment_key] }
              unit.as_json.merge(
                "assessments" => assessments.as_json,
                "tasks" => (tasks_by_unit[unit.id] || []).map do |task|
                  task.as_json.merge("assessment_key" => task.assessment_id && keys[task.assessment_id])
                end,
              )
            end,
          )
        end,
      )
    end
  end
end
