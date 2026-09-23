module Master
  # レセプト電算のコメントマスタ。配布ファイルの全置換取込と、施設設定でコメントコードを
  # 選ぶための一覧を持つ。手動メンテはしないので create/update/destroy は無い。
  class CommentsController < BaseController
    include Importable
    def index
      scope = Master::Comment.all
      scope = scope.where(comment_code: params[:comment_code].split(",")) if params[:comment_code].present?
      # パターン(20 選択式 / 30 文字 / 42 数値 / 50 年月日 …)で絞る。
      scope = scope.where(pattern: params[:pattern]) if params[:pattern].present?
      scope = scope.active if params[:active] == "true"
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_kana])
      end

      render json: paginate(scope.order(Arel.sql("publication_order NULLS LAST")).order(:comment_code))
    end
  end
end
