module Master
  # 採取管マスタのメンテナンス。配布ファイルが無い画面編集専用マスタなので
  # 取込は持たない(初期値は db:seed で入る)。
  class LabContainersController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::LabContainer.all
      # カンマ区切りで複数指定可(検体・オーダー項目の一覧が採取管名を一括解決するため)。
      if params[:container_code].present?
        scope = scope.where(container_code: params[:container_code].split(","))
      end
      scope = scope.where("name LIKE ?", "%#{sanitize_like(params[:name])}%") if params[:name].present?

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")))
    end
  end
end
