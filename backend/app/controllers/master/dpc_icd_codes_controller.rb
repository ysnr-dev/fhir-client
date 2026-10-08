module Master
  # DPC 電子点数表の ICD-10 → 診断群分類上6桁の対応表。様式1 の必須判定で
  # 傷病名の ICD-10 から診断群分類を引く。検索だけで、取込は DpcTablesController。
  class DpcIcdCodesController < BaseController
    def index
      return render json: lookup_result(params[:icd10].split(",")) if params[:icd10].present?

      edition = Master::DpcEdition.for(on_date) || Master::DpcIcdCode.latest_edition
      scope = Master::DpcIcdCode.in_edition(edition, on_date)
      scope = scope.where(mdc6: params[:mdc6]) if params[:mdc6].present?

      render json: paginate(scope)
    end

    private

    # icd10 指定時は、対応表の表記("I50$" の前方一致など)を解いて、問い合わせた
    # コードごとの行を返す。items の icd10 は対応表の値ではなく問い合わせたコード
    # (対応表の表記は icd_pattern)。複数コードをまとめて引くので、ページに
    # 区切らず全件を返す。
    def lookup_result(codes)
      items = Master::DpcIcdCode.lookup(codes, on: on_date).flat_map do |code, rows|
        rows.map { |row| row.as_json.merge("icd10" => code) }
      end

      { total: items.size, page: 1, per: [items.size, 1].max, items: items }
    end

    # 基準日(?on=YYYY-MM-DD、退院日など)。省略時は今日。
    def on_date
      params[:on].present? ? Date.parse(params[:on]) : FacilityClock.today
    rescue Date::Error
      FacilityClock.today
    end
  end
end
