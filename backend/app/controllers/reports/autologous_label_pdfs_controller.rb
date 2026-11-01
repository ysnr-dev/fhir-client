module Reports
  class AutologousLabelPdfsController < BaseController
    # GET /reports/autologous_labels/:procedure_id/pdf
    # 自己血の採血ラベル(採血記録 1 件 = 1 枚)。新規タブで表示できるよう inline。
    def show
      pdf = AutologousLabelReport.new(params[:procedure_id]).generate
      send_data pdf,
                filename: "autologous-label-#{params[:procedure_id]}.pdf",
                type: "application/pdf",
                disposition: "inline"
    end
  end
end
