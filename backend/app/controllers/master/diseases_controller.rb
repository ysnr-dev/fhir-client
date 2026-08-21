module Master
  class DiseasesController < BaseController
    include Importable
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::Disease.all
      scope = scope.where(management_number: params[:management_number]) if params[:management_number].present?
      scope = scope.where(exchange_code: params[:exchange_code]) if params[:exchange_code].present?
      scope = scope.where(icd10_2013: params[:icd10_2013]) if params[:icd10_2013].present?
      # 削除区分(変更区分=1)のレコードを除外して現行病名だけを返す。
      # IS DISTINCT FROM で change_category が NULL の手動作成レコードも残す。
      scope = scope.where("change_category IS DISTINCT FROM '1'") if params[:exclude_deleted].present?
      if params[:name].present?
        # 名称・カナに加えて病名索引テーブル(同義語・異字体など)からも検索する。
        scope = flexible_name_or_index_match(scope, params[:name], "1")
      end

      render json: paginate(scope)
    end
  end
end
