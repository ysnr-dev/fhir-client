module Master
  class ModifiersController < BaseController
    include Importable
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::Modifier.all
      scope = scope.where(management_number: params[:management_number]) if params[:management_number].present?
      scope = scope.where(exchange_code: params[:exchange_code]) if params[:exchange_code].present?
      scope = scope.where(modifier_category: params[:modifier_category]) if params[:modifier_category].present?
      # 削除区分(変更区分=1)のレコードを除外して現行修飾語だけを返す。
      scope = scope.where("change_category IS DISTINCT FROM '1'") if params[:exclude_deleted].present?
      if params[:name].present?
        # 名称・カナに加えて病名索引テーブル(同義語・異字体など)からも検索する。
        scope = flexible_name_or_index_match(scope, params[:name], "2")
      end

      render json: paginate(scope)
    end
  end
end
