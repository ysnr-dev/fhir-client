module Reports
  class PrescriptionPdfsController < BaseController
    # GET /reports/prescriptions/:order_id/pdf
    # 処方オーダー 1 件ぶんの処方箋。院外処方は様式第2号、それ以外は院内の簡易様式
    # (どちらで刷るかはオーダーの区分から backend が決める)。
    # 新規タブでそのまま表示できるよう inline で返す。
    def show
      pdf = PrescriptionReport.new(params[:order_id]).generate
      send_data pdf,
                filename: "prescription-#{params[:order_id]}.pdf",
                type: "application/pdf",
                disposition: "inline"
    end
  end
end
