module Master
  # 診療記録のタイトルのマスタ。フォームの選択肢として全件をまとめて引く。
  class ClinicalNoteTitlesController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      render json: paginate(
        Master::ClinicalNoteTitle.order(Arel.sql("display_order NULLS LAST")).order(:id),
        max_per: 500
      )
    end
  end
end
