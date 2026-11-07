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

    # POST /reports/prescriptions/pdf
    # 複数オーダーの処方箋を order_ids の順に 1 つの PDF にまとめる(一覧からの一括発行)。
    # id が多いと URL に載らないので POST で受ける。
    def batch
      order_ids = Array(params[:order_ids]).map(&:to_s).compact_blank
      return render json: { error: "invalid_prescription_batch" }, status: :bad_request if order_ids.empty?

      send_data PrescriptionReport.new(order_ids).generate,
                filename: "prescriptions.pdf",
                type: "application/pdf",
                disposition: "inline"
    end
  end
end
