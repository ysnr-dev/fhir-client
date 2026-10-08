module Master
  # 診断群分類の閲覧。MDC6 か名称で分類を選び、その分類の 14 桁と入院期間・点数を並べる。
  class DpcClassificationsController < BaseController
    # GET /master/dpc/classifications?q=&mdc6=&on=YYYY-MM-DD
    def index
      on = on_date
      edition = Master::DpcEdition.for(on)
      return render json: { edition: nil, classifications: [], points: [] } if edition.nil?

      classifications = Master::DpcClassification.in_edition(edition, on).where(level: "classification")
      if params[:q].present?
        query = "%#{ActiveRecord::Base.sanitize_sql_like(params[:q].to_s.unicode_normalize(:nfkc))}%"
        classifications = classifications.where("code LIKE :q OR name LIKE :q", q: query)
      end

      render json: {
        edition: edition,
        classifications: classifications.order(:code).limit(100).map { |row| { code: row.code, name: row.name } },
        points: params[:mdc6].present? ? points(edition, on, params[:mdc6].to_s) : []
      }
    end

    private

    def points(edition, on, mdc6)
      conversions = Master::DpcConversion.in_edition(edition, on).where(mdc6: mdc6)
      bundled = conversions.to_h { |row| [row.dpc_code, row.bundled] }
      Master::DpcPoint.in_edition(edition, on).where(dpc_code: bundled.keys).order(:serial).map do |row|
        {
          dpc_code: row.dpc_code, bundled: bundled[row.dpc_code],
          names: { disease: row.disease_name, surgery: row.surgery_name, proc1: row.proc1_name,
                   proc2: row.proc2_name, comorbidity: row.comorbidity_name, severity: row.severity_name },
          days: [row.days1, row.days2, row.days3], points: [row.points1, row.points2, row.points3]
        }
      end
    end

    def on_date
      params[:on].present? ? Date.parse(params[:on]) : FacilityClock.today
    rescue Date::Error
      FacilityClock.today
    end
  end
end
