module Master
  # 輸血製剤マスタのメンテナンス。画面から手動で登録する。
  # 食事の MealItemsController と同じ形(食種/主食の kind を製剤区分の category に
  # 置き換えただけ)。
  class TransfusionProductsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::TransfusionProduct.all
      # カンマ区切りで複数指定可(保存済みのオーダーから製剤情報を一括復元するため)。
      scope = scope.where(item_code: params[:item_code].split(",")) if params[:item_code].present?
      scope = scope.where(category: params[:category]) if params[:category].present?
      # active=true は今日オーダーできる製剤(有効期間内)だけに絞る。
      if params[:active] == "true"
        scope = scope
          .where("valid_from IS NULL OR valid_from <= ?", Date.current)
          .where("valid_to IS NULL OR valid_to >= ?", Date.current)
      end
      query = params[:name].presence || params[:keyword].presence
      scope = flexible_name_match(scope, query, ITEM_SEARCH_COLUMNS) if query

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")))
    end

    def create
      record = Master::TransfusionProduct.new(record_params)
      record.item_code = next_item_code if record.item_code.blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    private

    ITEM_SEARCH_COLUMNS = %w[search_name search_kana].freeze

    # 数字だけの製剤コードの最大値の次。ISBT128 の英字混じりのコードを手入力で
    # 入れられるようにしてあるので、それらは採番の計算から外す(食事と同じ)。
    def next_item_code
      max = Master::TransfusionProduct.where("item_code ~ '^[0-9]+$'")
                                      .maximum(Arel.sql("item_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      # id ではなく製剤コードでも引けるようにする。
      @record = Master::TransfusionProduct.find_by(item_code: params[:id]) ||
                Master::TransfusionProduct.find(params[:id])
    end
  end
end
