module Master
  # 看護計画の用語(看護診断・看護成果・看護介入)。画面は taxonomy ごとに木を組むため、
  # 領域・類・用語をまとめて引けるよう上限を緩めている。
  class NursingTermsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::NursingTerm.all
      scope = scope.where(taxonomy: params[:taxonomy]) if params[:taxonomy].present?
      scope = scope.where(level: params[:level]) if params[:level].present?
      scope = scope.where(parent_code: params[:parent_code]) if params[:parent_code].present?
      scope = scope.where(code: params[:code].to_s.split(",").map(&:strip)) if params[:code].present?
      scope = scope.where(active: ActiveModel::Type::Boolean.new.cast(params[:active])) if params[:active].present?
      scope = flexible_name_match(scope, params[:q], %w[search_name search_kana]) if params[:q].present?
      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:code), max_per: 500)
    end

    def destroy
      if @record.children?
        render json: { error: "配下に類または用語があるため削除できません" }, status: :unprocessable_content
        return
      end
      super
    end

    private

    def record_params
      params.permit(:taxonomy, :level, :code, :parent_code, :name, :name_kana, :diagnosis_type,
                    :definition, :guidance, :source, :active, :display_order,
                    items: Master::NursingTerm::ITEM_KEYS)
    end
  end
end
