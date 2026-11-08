module Master
  # 持ち主(院内共通 / 診療科 / 医師 / チーム)ごとに保存する定義(チャート定義・ダッシュボード・
  # データ抽出の条件・頻用病名)の共通の登録・参照。モデルは ScopedDefinition を include し、
  # scope / owner_id / owner_name / name / definition / display_order / active の列を持つ。
  # 認可は PractitionerScopeGuard(医師スコープの持ち主はログイン本人)。
  module ScopedDefinitions
    extend ActiveSupport::Concern
    include PractitionerScopeGuard

    included do
      before_action :set_record, only: %i[show update destroy]
      before_action :authorize_practitioner_scope!, only: %i[update destroy]
    end

    # 院内共通 + 指定した診療科 + 指定した医師 + 指定したチーム(カンマ区切り)の定義を全件返す。
    # 件数が少ない前提でページングせず、definition も含める(画面は一覧を引いたらそのまま使える)。
    def index
      records = model_class.roots_for(
        department_id: params[:department_id].presence,
        practitioner_id: params[:practitioner_id].presence,
        team_ids: team_ids_param,
      ).ordered
      render json: { total: records.size, items: records.map { |r| detail(r) } }
    end

    def show
      render json: detail(@record)
    end

    def create
      record = model_class.new(record_params)
      record.owner_id = forced_owner_id(record.scope) if record.scope == "practitioner"
      return render_forbidden if record.scope == "practitioner" && record.owner_id.blank?

      record.display_order = next_display_order(record) if params[:display_order].blank?
      if record.save
        render json: detail(record), status: :created
      else
        render_validation_errors(record)
      end
    end

    # 持ち主は付け替えさせない(別の持ち主に置きたいときは複製する)。
    def update
      if @record.update(record_params.except(:scope, :owner_id, :owner_name))
        render json: detail(@record)
      else
        render_validation_errors(@record)
      end
    end

    private

    def team_ids_param
      params[:team_id].to_s.split(",").map(&:strip).compact_blank
    end

    # BaseController の permit(column_names) は jsonb のネストを黙って落とすので、
    # definition だけは丸ごと受け取る(形の検証はモデルが担う)。
    def record_params
      permitted = params.permit(:scope, :owner_id, :owner_name, :name, :display_order, :active)
      if params.key?(:definition)
        raw = params[:definition]
        permitted[:definition] = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw
      end
      permitted
    end

    def next_display_order(record)
      (model_class.where(scope: record.scope, owner_id: record.owner_id).maximum(:display_order) || 0) + 1
    end

    def detail(record)
      record.as_json(only: %i[id code scope owner_id owner_name name display_order active updated_at])
            .merge("definition" => record.definition_with_defaults)
    end
  end
end
