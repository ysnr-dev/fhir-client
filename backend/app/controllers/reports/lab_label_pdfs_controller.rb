module Reports
  class LabLabelPdfsController < BaseController
    # GET /reports/lab_labels/:order_id/pdf
    # オーダー 1 件ぶんの検体ラベル(1 ページ = 採取管 1 本)。
    # 新規タブでそのまま表示できるよう inline で返す。
    def show
      pdf = LabLabelReport.new(params[:order_id]).generate
      send_data pdf,
                filename: "lab-labels-#{params[:order_id]}.pdf",
                type: "application/pdf",
                disposition: "inline"
    end
  end
end
