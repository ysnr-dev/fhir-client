module Reports
  class InjectionPdfsController < BaseController
    # GET /reports/injections/:order_id/pdf
    # 注射オーダー(1 日分)1 件ぶんの注射箋(注射指示票を兼ねる)。新規タブで表示できるよう inline。
    def show
      pdf = InjectionReport.new(params[:order_id]).generate_order
      send_data pdf,
                filename: "injection-#{params[:order_id]}.pdf",
                type: "application/pdf",
                disposition: "inline"
    end
  end
end
