module Reports
  class DischargeSummaryPdfsController < BaseController
    # GET /reports/discharge_summaries/:composition_id/pdf
    # 新規タブでそのまま表示できるよう inline で返す。
    def show
      pdf = DischargeSummaryReport.new(params[:composition_id]).generate
      send_data pdf,
                filename: "discharge-summary-#{params[:composition_id]}.pdf",
                type: "application/pdf",
                disposition: "inline"
    end
  end
end
