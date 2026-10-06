module Master
  # 持ち主(院内共通 / 診療科 / 医師)ごとに保存する定義(チャート定義・データ抽出の条件)の
  # 共通の登録・参照。モデルは scope / owner_id / owner_name / name / definition /
  # display_order / active と roots_for・definition_with_defaults を持つ(ChartDefinition と同じ形)。
  #
  # 認可: 医師かどうかは上流の PractitionerRole にしか無く backend からは引けないので、
  # 院内共通・診療科スコープの書き込みは画面側で医師に限る。backend が厳密に守るのは
  # 「医師スコープの持ち主はログイン本人」だけ。読み取りは誰でもできる。
  module ScopedDefinitions
    extend ActiveSupport::Concern

    included do
      before_action :set_record, only: %i[show update destroy]
      before_action :authorize_practitioner_scope!, only: %i[update destroy]
    end

    # 院内共通 + 指定した診療科 + 指定した医師の定義を全件返す。件数が少ない前提で
    # ページングせず、definition も含める(画面は一覧を引いたらそのまま使える)。
    def index
      records = model_class.roots_for(
        department_id: params[:department_id].presence,
        practitioner_id: params[:practitioner_id].presence,
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

    # 医師スコープの持ち主はログイン中の本人に固定する(他人の owner_id を送られても
    # 無視する)。認証なしモード(ADMIN_TOKEN 未設定)は開発の摩擦を無くすためのものなので
    # パラメータの owner_id を通す。administrator は医療従事者と紐付かないので nil に
    # なり、呼び出し側で 403 にする。
    def forced_owner_id(scope)
      return nil unless scope == "practitioner"
      return params[:owner_id].presence if @user_auth == :none

      current_user&.practitioner_fhir_id
    end

    def authorize_practitioner_scope!
      return unless @record.scope == "practitioner"
      return if @user_auth == :none

      render_forbidden unless current_user && @record.owner_id == current_user.practitioner_fhir_id
    end

    def render_forbidden
      render json: { error: "forbidden" }, status: :forbidden
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
