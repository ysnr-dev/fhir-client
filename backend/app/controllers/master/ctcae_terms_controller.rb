module Master
  # CTCAE(有害事象共通用語規準)の用語。有害事象の記録とレジメンマスタの
  # 「想定される副作用」で用語を選ぶのに使う。登録・編集は無く、
  # 配布 Excel の取り込み(import)と検索(index)だけ。
  class CtcaeTermsController < BaseController
    include Importable

    def index
      scope = Master::CtcaeTerm.all
      scope = scope.where(meddra_code: params[:meddra_code].split(",")) if params[:meddra_code].present?
      scope = scope.where(soc_ja: params[:soc]) if params[:soc].present?
      scope = flexible_name_match(scope, params[:name], %w[search_term]) if params[:name].present?

      # 配布ファイルの収載順(SOC ごとにまとまる)。
      render json: paginate(scope.order(:display_order))
    end

    # 選択モーダルの SOC(器官別大分類)の絞り込み。収載順で返す。
    def socs
      names = Master::CtcaeTerm.where.not(soc_ja: nil).order(:display_order).pluck(:soc_ja).uniq
      render json: { items: names }
    end
  end
end
