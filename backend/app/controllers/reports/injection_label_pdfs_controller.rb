module Reports
  class InjectionLabelPdfsController < BaseController
    # GET /reports/injection_labels/:order_id/pdf
    # 注射オーダー 1 件ぶんの注射ラベル(1 ページ = RP 1 つ)。
    def show
      pdf = InjectionReport.new(params[:order_id]).generate_labels
      send_data pdf,
                filename: "injection-labels-#{params[:order_id]}.pdf",
                type: "application/pdf",
                disposition: "inline"
    end
  end
end
