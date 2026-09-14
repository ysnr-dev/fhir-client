module Master
  # クリニカルパス(施設パス)定義マスタ(docs/clinical-pathway-design.md)。
  #
  # 本体と子(対象病名・病日・OAT ユニット・観察項目・タスク)を 1 リクエストで
  # 読み書きする。子は配列を丸ごと置換し、display_order は配列順で振り直す(レジメンと
  # 同じ)。OAT ユニット・観察項目・タスクの uuid キーは画面が採り、置換で行を作り直しても
  # 変わらない(適用後データの識別子に使うため)。同じキーを複数の病日に置いたものが
  # 「続き」(日をまたぐアウトカム・継続するタスク)で、一意なのは親(病日・OAT ユニット)の
  # 中だけ。外部キーは張らないので削除は transaction で
  # 片付ける。承認済・廃止は内容を凍結し、直すときは複製する。
  class PathwaysController < BaseController
    before_action :set_record, only: %i[show update destroy copy]

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

    def show
      render json: detail(@record)
    end

    def create
      record = Master::Pathway.new(record_params.merge(approval_attrs(nil, record_params[:status])))
      record.pathway_code = next_pathway_code if record.pathway_code.blank?
      Master::Pathway.transaction do
        record.save!
        replace_children(record)
        validate_content!(record)
      end
      render json: detail(record), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    rescue ContentInvalid => e
      render json: { errors: e.messages }, status: :unprocessable_content
    end

    def update
      return render_frozen if frozen_change?
      return render_unapproval if unapproving?

      Master::Pathway.transaction do
        @record.update!(update_params)
        replace_children(@record)
        validate_content!(@record)
      end
      render json: detail(@record)
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    rescue ContentInvalid => e
      render json: { errors: e.messages }, status: :unprocessable_content
    end

    # 複製。改訂版の作り方。コードは新しく採番し、承認は引き継がず下書きに戻す。
    # OAT ユニット・観察項目・タスクの uuid は写す(同じアウトカムを版をまたいで追える)。
    def copy
      target = Master::Pathway.new(
        @record.attributes.except("id", "pathway_code", "created_at", "updated_at",
                                  "status", "approved_on", "approved_by",
                                  "search_name", "search_kana", "search_short_name"),
      )
      target.pathway_code = next_pathway_code
      target.name = params[:name].presence || "#{@record.name}のコピー"
      target.status = "draft"
      target.copied_from_code = @record.pathway_code
      target.valid_from = nil
      target.valid_to = nil
      target.display_order = nil
      Master::Pathway.transaction do
        target.save!
        copy_children(@record, target)
      end
      render json: detail(target), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    end

    # 削除できるのは下書きだけ。承認済・廃止は施設の記録として残す。
    def destroy
      if @record.status != "draft"
        return render json: { errors: ["承認済・廃止のパスは削除できません。廃止にして使わないようにしてください"] },
                      status: :unprocessable_content
      end

      Master::Pathway.transaction do
        delete_children(@record.pathway_code)
        @record.destroy!
      end
      head :no_content
    end

    private

    # 内容の検証に落ちたとき(モデル単体では判定できないもの)。
    class ContentInvalid < StandardError
      attr_reader :messages

      def initialize(messages)
        @messages = messages
        super(messages.join(" / "))
      end
    end

    SEARCH_COLUMNS = %w[search_name search_kana search_short_name].freeze

    PATHWAY_ATTRS = %i[
      pathway_code name short_name name_kana version department_code department_name setting
      scheduled_days adaptive_criteria protocol_base status approved_on approved_by
      valid_from valid_to display_order note copied_from_code
    ].freeze

    # 承認済・廃止でも動かせる項目。内容は凍結し、「使うのをやめる」「並び順を変える」だけ残す。
    FROZEN_EDITABLE_ATTRS = %i[status valid_from valid_to display_order].freeze
    INDICATION_ATTRS = %w[management_number name icd10].freeze
    EVENT_ATTRS = %w[elapsed_days path_step path_step_name title allowable_condition_type allowable_days
                     allowable_range_low allowable_range_high note].freeze
    UNIT_ATTRS = %w[unit_key name category code_system code critical note].freeze
    ASSESSMENT_ATTRS = %w[assessment_key name category_code category_name code_system code proper_value
                          nursing_observation_manage_no note].freeze
    TASK_ATTRS = %w[task_key name category_lv1 category_lv2 code order_type order_label order_values
                    order_schema_version note].freeze

    def record_params
      params.permit(*PATHWAY_ATTRS)
    end

    # 更新で受ける値。承認日・承認者はサーバーが決める。
    def update_params
      permitted = record_params.except(:pathway_code, :approved_on, :approved_by)
      permitted = permitted.slice(*FROZEN_EDITABLE_ATTRS) if frozen_record?
      permitted.merge(approval_attrs(@record.status, permitted[:status]))
    end

    def frozen_record?
      %w[approved retired].include?(@record.status)
    end

    # 凍結中に内容を変えようとしているか。子が 1 種類でも送られていれば内容の変更。
    def frozen_change?
      return false unless frozen_record?

      children_sent = %i[indications events].any? { |k| params.key?(k) }
      content_sent = record_params.except(:pathway_code, :approved_on, :approved_by, *FROZEN_EDITABLE_ATTRS)
                                  .to_h.any? { |k, v| @record[k].to_s != v.to_s }
      children_sent || content_sent
    end

    # 承認済・廃止から下書きへは戻せない(戻せると凍結をすり抜けられる)。
    def unapproving?
      frozen_record? && record_params[:status] == "draft"
    end

    def render_unapproval
      render json: {
        errors: ["承認を取り消せません。使わないようにするには廃止にしてください"],
      }, status: :unprocessable_content
    end

    def render_frozen
      render json: {
        errors: ["承認済・廃止のパスは内容を変更できません。複製して新しいパスとして直してください"],
      }, status: :unprocessable_content
    end

    def approval_attrs(previous_status, next_status)
      return {} if next_status.blank? || previous_status == next_status

      next_status == "approved" ? { approved_on: Date.current, approved_by: approver_id } : {}
    end

    # 承認者。認証なしモード(開発)ではパラメータを通す。
    def approver_id
      return params[:approved_by].presence if @user_auth == :none

      current_user&.practitioner_fhir_id
    end

    # サンプル(db/seed_data/pathways/*.json)が使う帯。施設の採番はこの手前で行う。
    SAMPLE_CODE_FLOOR = 900_000

    def next_pathway_code
      max = Master::Pathway.where("pathway_code ~ '^[0-9]+$'")
                           .where("pathway_code::bigint < ?", SAMPLE_CODE_FLOOR)
                           .maximum(Arel.sql("pathway_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      @record = Master::Pathway.find_by(pathway_code: params[:id]) || Master::Pathway.find(params[:id])
    end

    # 子の配列が来た種別だけ置換する(来ていない種別は触らない)。
    def replace_children(record)
      code = record.pathway_code
      if params.key?(:indications)
        Master::PathwayIndication.where(pathway_code: code).delete_all
        each_row(params[:indications]) do |row, index|
          Master::PathwayIndication.create!(row.slice(*INDICATION_ATTRS).merge(pathway_code: code, display_order: index + 1))
        end
      end
      return unless params.key?(:events)

      delete_event_tree(code)
      each_row(params[:events]) do |row, index|
        event = Master::PathwayEvent.create!(row.slice(*EVENT_ATTRS).merge(pathway_code: code, display_order: index + 1))
        each_row(row["oat_units"]) do |unit_row, unit_index|
          create_unit_tree(code, event, unit_row, unit_index)
        end
      end
    end

    # OAT ユニットとその観察項目・タスクを作る。タスク→観察項目は assessment_key(uuid)で
    # 受け、同じユニットの中で新しい id に引き直す(置換で id が変わるため)。
    def create_unit_tree(code, event, unit_row, unit_index)
      unit = Master::PathwayOatUnit.create!(
        unit_row.slice(*UNIT_ATTRS).merge(
          pathway_code: code, event_id: event.id, display_order: unit_index + 1,
          unit_key: unit_row["unit_key"].presence || SecureRandom.uuid,
        ),
      )
      assessment_ids = {}
      each_row(unit_row["assessments"]) do |row, index|
        assessment = Master::PathwayAssessment.create!(
          row.slice(*ASSESSMENT_ATTRS).merge(
            pathway_code: code, unit_id: unit.id, display_order: index + 1,
            assessment_key: row["assessment_key"].presence || SecureRandom.uuid,
          ),
        )
        assessment_ids[assessment.assessment_key] = assessment.id
      end
      each_row(unit_row["tasks"]) do |row, index|
        key = row["assessment_key"].presence
        if key && !assessment_ids.key?(key)
          raise ContentInvalid, ["タスク「#{row['name']}」が結ぶ観察項目が同じ OAT ユニットにありません"]
        end

        Master::PathwayTask.create!(
          row.slice(*TASK_ATTRS).merge(
            pathway_code: code, unit_id: unit.id, display_order: index + 1,
            task_key: row["task_key"].presence || SecureRandom.uuid,
            assessment_id: key && assessment_ids[key],
            order_values: row["order_values"].is_a?(Hash) ? row["order_values"] : {},
          ),
        )
      end
    end

    # 画面の validatePathwayDraft は入力中の案内で、API を直に叩けば素通りする。
    # どの入口から来ても効かせたい検証をここに置く。下書きは緩く、承認で厳しくする。
    def validate_content!(record)
      messages = always_invalid_messages(record)
      messages += approval_invalid_messages(record) if record.status == "approved"
      raise ContentInvalid, messages if messages.any?
    end

    # 下書きでも通さないもの。識別子の重なり(同じ病日・OAT ユニットの中)はモデルの検証で弾く。
    def always_invalid_messages(record)
      events = record.events.reload.to_a
      duplicated = events.group_by(&:event_key).select { |_, v| v.size > 1 }.keys
      duplicated.map { |k| "病日 #{k} が重複しています" }
    end

    # 承認するときだけ求める完全性。ここを通ったパスは、患者に適用したときに
    # 病日ごとのアウトカムとタスクを展開できる。
    def approval_invalid_messages(record)
      events = record.events.to_a
      messages = []
      messages << "適応基準がありません" if record.adaptive_criteria.blank?
      messages << "パス予定日数がありません" if record.scheduled_days.blank?
      return messages + ["病日がありません"] if events.empty?

      last_day = events.map(&:elapsed_days).max
      if record.scheduled_days.present? && record.scheduled_days < last_day
        messages << "パス予定日数(#{record.scheduled_days} 日)より後の病日(#{last_day} 日目)があります"
      end
      units_by_event = record.oat_units.group_by(&:event_id)
      events.each do |event|
        messages << "#{event_label(event)} に OAT ユニットがありません" if units_by_event[event.id].blank?
      end
      record.tasks.each do |task|
        next unless task.order_template? && task.order_values.blank?

        messages << "タスク「#{task.name}」のオーダー雛形が空です"
      end
      messages
    end

    def event_label(event)
      event.title.presence || "病日 #{event.event_key}"
    end

    def each_row(raw)
      Array(raw).each_with_index do |row, index|
        row = row.to_unsafe_h if row.respond_to?(:to_unsafe_h)
        yield row.to_h.stringify_keys, index
      end
    end

    def copy_children(source, target)
      code = target.pathway_code
      source.indications.each { |r| Master::PathwayIndication.create!(child_attrs(r).merge(pathway_code: code)) }
      source.events.each do |event|
        copied_event = Master::PathwayEvent.create!(child_attrs(event).merge(pathway_code: code))
        event.oat_units.each do |unit|
          copied_unit = Master::PathwayOatUnit.create!(child_attrs(unit).merge(pathway_code: code, event_id: copied_event.id))
          assessment_ids = {}
          unit.assessments.each do |assessment|
            copied = Master::PathwayAssessment.create!(child_attrs(assessment).merge(pathway_code: code, unit_id: copied_unit.id))
            assessment_ids[assessment.id] = copied.id
          end
          unit.tasks.each do |task|
            Master::PathwayTask.create!(
              child_attrs(task).merge(pathway_code: code, unit_id: copied_unit.id,
                                      assessment_id: task.assessment_id && assessment_ids[task.assessment_id]),
            )
          end
        end
      end
    end

    def child_attrs(record)
      record.attributes.except("id", "pathway_code", "event_id", "unit_id", "assessment_id", "created_at", "updated_at")
    end

    def delete_event_tree(code)
      Master::PathwayTask.where(pathway_code: code).delete_all
      Master::PathwayAssessment.where(pathway_code: code).delete_all
      Master::PathwayOatUnit.where(pathway_code: code).delete_all
      Master::PathwayEvent.where(pathway_code: code).delete_all
    end

    def delete_children(code)
      delete_event_tree(code)
      Master::PathwayIndication.where(pathway_code: code).delete_all
    end

    def summary(pathway, event_count = nil, last_day = nil)
      pathway.as_json(except: %w[search_name search_kana search_short_name])
             .merge("event_count" => event_count, "last_day" => last_day)
    end

    # 詳細は子を入れ子で同梱し、画面が 1 リクエストで開けるようにする。
    def detail(pathway)
      code = pathway.pathway_code
      events = pathway.events.to_a
      units_by_event = Master::PathwayOatUnit.where(pathway_code: code).in_display_order.group_by(&:event_id)
      assessments_by_unit = Master::PathwayAssessment.where(pathway_code: code).in_display_order.group_by(&:unit_id)
      tasks_by_unit = Master::PathwayTask.where(pathway_code: code).in_display_order.group_by(&:unit_id)
      summary(pathway, events.map(&:elapsed_days).uniq.size, events.map(&:elapsed_days).max).merge(
        "indications" => pathway.indications.as_json,
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
