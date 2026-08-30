module Master
  # 食種マスタのメンテナンス。画面から手動で登録する。主食・副食形態
  # (MealItemsController)と同じ素朴な形で、種別(category_code)の絞り込みだけ多い。
  class MealDietsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::MealDiet.all
      # カンマ区切りで複数指定可(保存済みのオーダーから食種情報を一括復元するため)。
      scope = scope.where(item_code: params[:item_code].split(",")) if params[:item_code].present?
      scope = scope.where(category_code: params[:category_code]) if params[:category_code].present?
      # active=true は今日オーダーできる食種(有効期間内)だけに絞る。
      scope = scope.active_on if params[:active] == "true"
      query = params[:name].presence || params[:keyword].presence
      scope = flexible_name_match(scope, query, SEARCH_COLUMNS) if query

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
    end

    def create
      record = Master::MealDiet.new(record_params)
      record.item_code = next_item_code if record.item_code.blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    private

    SEARCH_COLUMNS = %w[search_name search_kana].freeze

    # 数字だけの食種コードの最大値の次。SS-MIX2 互換のコード(NPO など)を手入力で
    # 入れられるようにしてあるので、英字混じりのコードは採番の計算から外す。
    def next_item_code
      max = Master::MealDiet.where("item_code ~ '^[0-9]+$'")
                            .maximum(Arel.sql("item_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      # id ではなく食種コードでも引けるようにする。
      @record = Master::MealDiet.find_by(item_code: params[:id]) ||
                Master::MealDiet.find(params[:id])
    end
  end
end
