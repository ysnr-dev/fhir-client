module Master
  # 化学療法レジメンマスタ(docs/chemo-regimen-design.md)。
  #
  # 本体と子(適応疾患・投与ステップ・薬剤・検査基準・副作用)を 1 リクエストで
  # 読み書きする。子は配列を丸ごと置換し、display_order は配列順で振り直す
  # (order_sets の entries と同じ)。外部キーは張らないので削除は transaction で片付ける。
  class RegimensController < BaseController
    before_action :set_record, only: %i[show update destroy copy]

    def index
      scope = Master::Regimen.all
      scope = scope.where(department_code: params[:department_code]) if params[:department_code].present?
      scope = scope.where(status: params[:status]) if params[:status].present?
      scope = scope.where(purpose: params[:purpose]) if params[:purpose].present?
      scope = scope.active_on if params[:active] == "true"
      # この薬剤を含むレジメン(カンマ区切りで複数指定可、いずれかを含めばよい)。
      if params[:medicine_code].present?
        codes = Master::RegimenDrug.where(medicine_code: params[:medicine_code].split(","))
                                   .select(:regimen_code)
        scope = scope.where(regimen_code: codes)
      end
      query = params[:name].presence || params[:keyword].presence
      scope = flexible_name_match(scope, query, SEARCH_COLUMNS) if query

      result = paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:regimen_code))
      result[:items] = result[:items].map { |r| summary(r) }
      render json: result
    end

    def show
      render json: detail(@record)
    end

    def create
      record = Master::Regimen.new(record_params)
      record.regimen_code = next_regimen_code if record.regimen_code.blank?
      Master::Regimen.transaction do
        record.save!
        replace_children(record)
      end
      render json: detail(record), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    end

    def update
      Master::Regimen.transaction do
        @record.update!(record_params.except(:regimen_code))
        replace_children(@record)
      end
      render json: detail(@record)
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    end

    # 複製。派生レジメン(減量版・隔週版)の作り方。コードは新しく採番し、
    # 承認は引き継がず下書きに戻す。
    def copy
      target = Master::Regimen.new(
        @record.attributes.except("id", "regimen_code", "created_at", "updated_at",
                                  "status", "approved_on", "approved_by",
                                  "search_name", "search_kana", "search_short_name"),
      )
      target.regimen_code = next_regimen_code
      target.name = params[:name].presence || "#{@record.name}のコピー"
      target.status = "draft"
      Master::Regimen.transaction do
        target.save!
        copy_children(@record, target)
      end
      render json: detail(target), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    end

    def destroy
      Master::Regimen.transaction do
        delete_children(@record.regimen_code)
        @record.destroy!
      end
      head :no_content
    end

    private

    SEARCH_COLUMNS = %w[search_name search_kana search_short_name].freeze

    REGIMEN_ATTRS = %i[
      regimen_code name short_name name_kana department_code department_name purpose setting
      treatment_days rest_days planned_cycles emetic_risk status approved_on approved_by
      indication_note discontinuation_criteria dose_reduction_criteria references_note
      valid_from valid_to display_order note
    ].freeze
    INDICATION_ATTRS = %w[management_number name icd10].freeze
    STEP_ATTRS = %w[name days usage_type route_code method_code line_code infusion_minutes rate
                    device_note usage_code dose_days note].freeze
    DRUG_ATTRS = %w[drug_role medicine_code dose_basis dose_value dose_unit dose_max note].freeze
    LAB_CRITERION_ATTRS = %w[category analyte_code item_name unit lower_limit upper_limit note].freeze
    ADVERSE_EVENT_ATTRS = %w[term grade note].freeze

    def record_params
      params.permit(*REGIMEN_ATTRS)
    end

    # 数字だけのレジメンコードの最大値の次(他マスタと同じ採番)。
    def next_regimen_code
      max = Master::Regimen.where("regimen_code ~ '^[0-9]+$'")
                           .maximum(Arel.sql("regimen_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      @record = Master::Regimen.find_by(regimen_code: params[:id]) || Master::Regimen.find(params[:id])
    end

    # 子の配列が来た種別だけ置換する(来ていない種別は触らない)。
    def replace_children(record)
      code = record.regimen_code
      if params.key?(:indications)
        Master::RegimenIndication.where(regimen_code: code).delete_all
        each_row(params[:indications]) do |row, index|
          Master::RegimenIndication.create!(row.slice(*INDICATION_ATTRS).merge(regimen_code: code, display_order: index + 1))
        end
      end
      if params.key?(:steps)
        Master::RegimenDrug.where(regimen_code: code).delete_all
        Master::RegimenStep.where(regimen_code: code).delete_all
        each_row(params[:steps]) do |row, index|
          step = Master::RegimenStep.create!(
            row.slice(*STEP_ATTRS).merge(regimen_code: code, display_order: index + 1, days: normalize_days(row["days"])),
          )
          each_row(row["drugs"]) do |drug, drug_index|
            Master::RegimenDrug.create!(
              drug.slice(*DRUG_ATTRS).merge(regimen_code: code, step_id: step.id, display_order: drug_index + 1),
            )
          end
        end
      end
      if params.key?(:lab_criteria)
        Master::RegimenLabCriterion.where(regimen_code: code).delete_all
        each_row(params[:lab_criteria]) do |row, index|
          Master::RegimenLabCriterion.create!(row.slice(*LAB_CRITERION_ATTRS).merge(regimen_code: code, display_order: index + 1))
        end
      end
      return unless params.key?(:adverse_events)

      Master::RegimenAdverseEvent.where(regimen_code: code).delete_all
      each_row(params[:adverse_events]) do |row, index|
        Master::RegimenAdverseEvent.create!(row.slice(*ADVERSE_EVENT_ATTRS).merge(regimen_code: code, display_order: index + 1))
      end
    end

    def each_row(raw)
      Array(raw).each_with_index do |row, index|
        row = row.to_unsafe_h if row.respond_to?(:to_unsafe_h)
        yield row.to_h.stringify_keys, index
      end
    end

    # 投与日は "1,8,15" の文字列でも配列でも受ける。整数に直せないものは
    # そのまま残してモデルの検証に落とす。
    def normalize_days(raw)
      values = raw.is_a?(String) ? raw.split(/[,、\s]+/) : Array(raw)
      values.reject(&:blank?).map { |v| Integer(v.to_s, exception: false) || v }
    end

    def copy_children(source, target)
      code = target.regimen_code
      source.indications.each { |r| Master::RegimenIndication.create!(child_attrs(r).merge(regimen_code: code)) }
      source.steps.each do |step|
        copied = Master::RegimenStep.create!(child_attrs(step).merge(regimen_code: code))
        step.drugs.each do |drug|
          Master::RegimenDrug.create!(child_attrs(drug).merge(regimen_code: code, step_id: copied.id))
        end
      end
      source.lab_criteria.each { |r| Master::RegimenLabCriterion.create!(child_attrs(r).merge(regimen_code: code)) }
      source.adverse_events.each { |r| Master::RegimenAdverseEvent.create!(child_attrs(r).merge(regimen_code: code)) }
    end

    def child_attrs(record)
      record.attributes.except("id", "regimen_code", "step_id", "created_at", "updated_at")
    end

    def delete_children(code)
      Master::RegimenDrug.where(regimen_code: code).delete_all
      Master::RegimenStep.where(regimen_code: code).delete_all
      Master::RegimenIndication.where(regimen_code: code).delete_all
      Master::RegimenLabCriterion.where(regimen_code: code).delete_all
      Master::RegimenAdverseEvent.where(regimen_code: code).delete_all
    end

    def summary(regimen)
      regimen.as_json(except: %w[search_name search_kana search_short_name]).merge("cycle_days" => regimen.cycle_days)
    end

    # 詳細は子を名称付きで同梱し、画面が 1 リクエストで開けるようにする
    # (薬剤名は薬剤マスタ、内服の用法名は用法マスタから引く)。
    def detail(regimen)
      steps = regimen.steps.to_a
      drugs_by_step = Master::RegimenDrug.with_names.where(step_id: steps.map(&:id)).in_display_order.group_by(&:step_id)
      usage_names = Master::MedicineUsage.where(usage_code: steps.filter_map(&:usage_code))
                                         .pluck(:usage_code, :usage_name).to_h
      summary(regimen).merge(
        "indications" => regimen.indications.as_json,
        "steps" => steps.map do |s|
          s.as_json.merge("usage_name" => usage_names[s.usage_code], "drugs" => (drugs_by_step[s.id] || []).as_json)
        end,
        "lab_criteria" => regimen.lab_criteria.as_json,
        "adverse_events" => regimen.adverse_events.as_json,
      )
    end
  end
end
