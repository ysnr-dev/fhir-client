module Master
  # 結果項目の基準値。結果項目の詳細画面から編集する。
  class LabReferenceRangesController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::LabReferenceRange.all
      # カンマ区切りで複数指定可(結果登録画面が入力中の項目の基準値をまとめて引くため)。
      if params[:result_item_code].present?
        scope = scope.where(result_item_code: params[:result_item_code].split(","))
      end

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
    end

    def create
      record = Master::LabReferenceRange.new(record_params)
      # 追加順に並べる(明示されていれば従う)。
      record.display_order ||= next_display_order(record.result_item_code)
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    private

    def next_display_order(result_item_code)
      (Master::LabReferenceRange.where(result_item_code: result_item_code).maximum(:display_order) || 0) + 1
    end
  end
end
