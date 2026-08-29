module Master
  # 食事オーダー項目(食種・主食)のメンテナンス。画面から手動で登録する。
  # 処置の TreatmentItemsController から、セット構成・実施入力データセット・
  # レセ電算コードの JOIN を落とした素朴な形。
  class MealItemsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::MealItem.all
      # カンマ区切りで複数指定可(保存済みのオーダーから項目情報を一括復元するため)。
      scope = scope.where(item_code: params[:item_code].split(",")) if params[:item_code].present?
      # diet = 食種 / staple = 主食。オーダー画面はどちらかだけを引く。
      scope = scope.where(kind: params[:kind]) if params[:kind].present?
      # 種別(分類)。食種にしか付かないので、指定されたら実質 kind=diet に絞られる。
      scope = scope.where(category_code: params[:category_code]) if params[:category_code].present?
      # active=true は今日オーダーできる項目(有効期間内)だけに絞る。
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
      record = Master::MealItem.new(record_params)
      record.item_code = next_item_code if record.item_code.blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    private

    ITEM_SEARCH_COLUMNS = %w[search_name search_kana].freeze

    # 数字だけの項目コードの最大値の次。SS-MIX2 互換のコード(NPO など)を手入力で
    # 入れられるようにしてあるので、英字混じりのコードは採番の計算から外す。
    def next_item_code
      max = Master::MealItem.where("item_code ~ '^[0-9]+$'")
                            .maximum(Arel.sql("item_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      # id ではなく項目コードでも引けるようにする。
      @record = Master::MealItem.find_by(item_code: params[:id]) ||
                Master::MealItem.find(params[:id])
    end
  end
end
