module Reports
  class PathoLabelPdfsController < BaseController
    # GET /reports/patho_labels/:order_id/pdf
    # 病理検査オーダー 1 件ぶんの検体ラベル(1 ページ = 容器 1 つ)。
    # 新規タブでそのまま表示できるよう inline で返す。
    def show
      pdf = PathoLabelReport.new(params[:order_id]).generate
      send_data pdf,
                filename: "patho-labels-#{params[:order_id]}.pdf",
                type: "application/pdf",
                disposition: "inline"
    end
  end
end
