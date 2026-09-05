module Master
  # 患者の診療上の注意の区分マスタ。seed の初期値を画面でメンテする
  # (病理の採取法マスタと同じ扱い)。
  class PatientCautionsController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      render json: paginate(
        Master::PatientCaution.order(Arel.sql("display_order NULLS LAST")).order(:id)
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
