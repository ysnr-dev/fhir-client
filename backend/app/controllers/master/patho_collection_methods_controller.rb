module Master
  # 病理検査オーダーの採取法(JAHIS テーブル LPATHO004)。seed の初期値を画面で
  # メンテする施設マスタ(細菌検査の採取方法マスタと同じ扱い)。
  class PathoCollectionMethodsController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      render json: paginate(
        Master::PathoCollectionMethod.order(Arel.sql("display_order NULLS LAST")).order(:id)
      )
    end

    def update
      if @record.update(record_params.except("code"))
        render json: @record
      else
        render_validation_errors(@record)
      end
    end
  end
end
