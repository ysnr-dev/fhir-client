module Reports
  class TransfusionCardPdfsController < BaseController
    # GET /reports/transfusion_cards/:patient_id/pdf
    # 輸血関連情報カード(患者 1 人ぶん)。新規タブで表示できるよう inline。
    def show
      pdf = TransfusionCardReport.new(params[:patient_id]).generate
      send_data pdf,
                filename: "transfusion-card-#{params[:patient_id]}.pdf",
                type: "application/pdf",
                disposition: "inline"
    end
  end
end
