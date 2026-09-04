module Master
  # 郵便番号マスタ(日本郵便 utf_ken_all.csv)。配布ファイルそのままの参照表なので
  # 取込と検索だけを持ち、画面からの編集は無い。
  class PostalCodesController < BaseController
    include Importable

    def index
      scope = Master::PostalCode.all
      # 患者登録の住所補完はここだけを使う。1 つの郵便番号が複数の町域を表す
      # ことがあるため、絞っても複数件返りうる。
      scope = scope.for_code(params[:postal_code]) if params[:postal_code].present?

      render json: paginate(scope.order(:postal_code, :id))
    end
  end
end
