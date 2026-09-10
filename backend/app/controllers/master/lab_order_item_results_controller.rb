module Master
  # オーダー項目 → 結果項目の対応(1:N)。オーダー項目の詳細画面から編集する。
  class LabOrderItemResultsController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::LabOrderItemResult.includes(:result_item)
      # どちらもカンマ区切りで複数指定可(結果登録画面がオーダーの検査項目を
      # まとめて展開するため)。
      if params[:order_item_code].present?
        scope = scope.where(order_item_code: params[:order_item_code].split(","))
      end
      if params[:result_item_code].present?
        scope = scope.where(result_item_code: params[:result_item_code].split(","))
      end

      result = paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
      # 結果項目(材料名付き)を入れ子で添える(展開が 1 リクエストで済むように)。
      render json: result.merge(items: Master::LabOrderItemResult.as_json_with_result_items(result[:items].to_a))
    end

    def create
      record = Master::LabOrderItemResult.new(record_params)
      # 追加順に並べる(明示されていれば従う)。
      record.display_order ||= next_display_order(record.order_item_code)
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    private

    def next_display_order(order_item_code)
      (Master::LabOrderItemResult.where(order_item_code: order_item_code).maximum(:display_order) || 0) + 1
    end
  end
end
