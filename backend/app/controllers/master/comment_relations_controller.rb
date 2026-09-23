module Master
  # レセプト電算のコメント関連テーブル。配布ファイルの全置換取込と、診療行為コードに関係する
  # コメントコードの候補一覧(施設設定・項目マスタでコメントを選ぶとき)を持つ。
  class CommentRelationsController < BaseController
    include Importable
    def index
      scope = Master::CommentRelation.active.sendable
      # カンマ区切りで複数指定可(区分 × 療法士のコードをまとめて引く)。
      scope = scope.where(procedure_code: params[:procedure_code].split(",")) if params[:procedure_code].present?
      scope = scope.where(comment_code: params[:comment_code].split(",")) if params[:comment_code].present?

      render json: paginate(scope.order(:procedure_code, Arel.sql("publication_order NULLS LAST"), :comment_code))
    end
  end
end
