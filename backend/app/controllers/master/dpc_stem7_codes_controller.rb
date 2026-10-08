module Master
  # K コード → 手術基幹コード(STEM7)の対応表。様式1 の手術情報で候補を引く。
  # 配布 Excel の取込(import)と検索(index)だけで、登録・編集は無い。
  class DpcStem7CodesController < BaseController
    include Importable

    # k_code はカンマ区切りで複数。様式1 の書き方にそろえて引き、items の k_code は
    # そろえた後の値(問い合わせた値と書き方が違えば、呼び出し側もそろえて突き合わせる)。
    def index
      scope = Master::DpcStem7Code.all
      if params[:k_code].present?
        codes = params[:k_code].split(",").map { |code| Master::DpcStem7Code.normalize_k_code(code) }
        scope = scope.where(k_code: codes)
      end

      render json: paginate(scope.order(:display_order))
    end

    private

    def import_result_json(result)
      { imported: result.imported_count, skipped: result.skipped_count }
    end
  end
end
