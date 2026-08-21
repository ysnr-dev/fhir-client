module Master
  # JJ1017 の代表的頻用コード集(別表F)。オーダー項目マスタの初期データを
  # 一括作成するときの選択元なので、検索と取込だけを持つ。
  class RadFrequentCodesController < BaseController
    include Importable
    def index
      scope = Master::RadJj1017FrequentCode.all
      scope = scope.where(category: params[:category]) if params[:category].present?
      # 32桁コードの先頭1桁 = 種別(モダリティ)。撮影種別で候補を絞るために使う。
      if params[:modality_code].present?
        scope = scope.where("LEFT(jj1017_code, 1) IN (?)", params[:modality_code].split(","))
      end
      # 8〜10桁目 = 部位(小部位)。
      if params[:body_part_code].present?
        scope = scope.where("SUBSTRING(jj1017_code FROM 8 FOR 3) IN (?)", params[:body_part_code].split(","))
      end
      # 既にオーダー項目として登録済みのコードを除く(一括作成の選択画面用)。
      if params[:unregistered] == "true"
        scope = scope.where.not(
          jj1017_code: Master::RadItem.where.not(jj1017_code: nil).select(:jj1017_code)
        )
      end
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name])
      end

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:id))
    end

    private

    def import_result_json(result)
      {
        imported: result.imported_count,
        skipped: result.skipped_count,
        categories: result.category_counts
      }
    end
  end
end
