module Reports
  class LayoutsController < BaseController
    # GET /reports/layouts?canonical=<url|version>
    # frontend が「PDF」ボタンの表示可否を判定するための軽い照会。
    # canonical の | は URL エンコード(%7C)されて届く。
    def show
      layout = ReportLayout.for_canonical(params[:canonical].to_s)
      render json: {
        registered: layout.present?,
        name: layout&.name,
        updated_at: layout&.updated_at
      }
    end
  end
end
