module Reports
  class LabResultPdfsController < BaseController
    # GET /reports/lab_results/:report_id/pdf
    # 検体検査結果(DiagnosticReport)1 件ぶんの報告書。新規タブで表示できるよう inline。
    def show
      pdf = LabResultReport.new(params[:report_id]).generate
      send_data pdf,
                filename: "lab-result-#{params[:report_id]}.pdf",
                type: "application/pdf",
                disposition: "inline"
    end
  end
end
