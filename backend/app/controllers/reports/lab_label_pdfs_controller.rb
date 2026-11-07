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

    # POST /reports/lab_labels/pdf
    # 複数オーダーの検体ラベルを order_ids の順に 1 つの PDF にまとめる(一覧からの一括発行)。
    # scope(LabLabelReport::SCOPES)で刷る管を選ぶ。id が多いと URL に載らないので POST で受ける。
    def batch
      order_ids = Array(params[:order_ids]).map(&:to_s).compact_blank
      scope = params[:scope].to_s
      if order_ids.empty? || LabLabelReport::SCOPES.exclude?(scope)
        return render json: { error: "invalid_label_batch" }, status: :bad_request
      end

      send_data LabLabelReport.new(order_ids, scope:).generate,
                filename: "lab-labels.pdf",
                type: "application/pdf",
                disposition: "inline"
    end
  end
end
