module Master
  # 看護必要度のレセプト電算処理システム用コード一覧(別紙7・17・18 の別表1・別表2)。配布 Excel の取込(import)と、
  # 実施記録のコードから当たる行を引く検索(index)だけで、登録・編集は無い。
  class NursingAcuityCodesController < BaseController
    include Importable

    MAX_CODES = 500

    # code はカンマ区切りで複数(実施記録に出てきたコード)。当たる行を版・種類を問わずまとめて返す
    # (どの版の項目に当たるかは行の form で見分ける)。code を渡さなければ件数だけ(版 × 種類ごと)を返す(取込の確認用)。
    def index
      if params[:code].blank?
        counts = Master::NursingAcuityCode.group(:form, :kind).count.map do |(form, kind), count|
          { form: form, kind: kind, count: count }
        end
        return render json: { counts: counts }
      end

      codes = params[:code].split(",").map(&:strip).compact_blank.uniq.first(MAX_CODES)
      items = Master::NursingAcuityCode.where(code: codes).order(:form, :kind, :display_order)
      render json: { total: items.size, items: items.as_json(only: %i[form kind item_code code name form_i_only days]) }
    end

    private

    def import_result_json(result)
      { imported: result.imported_count, skipped: result.skipped_count }
    end
  end
end
