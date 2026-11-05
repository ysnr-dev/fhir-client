module Reports
  class MicroLabelPdfsController < BaseController
    # GET /reports/micro_labels/:order_id/pdf
    # 細菌検査オーダー 1 件ぶんの検体ラベル(1 ページ = 容器 1 つ)。
    # 新規タブでそのまま表示できるよう inline で返す。
    def show
      pdf = MicroLabelReport.new(params[:order_id]).generate
      send_data pdf,
                filename: "micro-labels-#{params[:order_id]}.pdf",
                type: "application/pdf",
                disposition: "inline"
    end
  end
end
