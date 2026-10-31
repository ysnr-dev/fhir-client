module Reports
  class RegimenMasterPdfsController < BaseController
    # GET /reports/regimen_masters/:id/pdf
    # 外部公開用のレジメン(患者情報なし)。承認済のレジメンだけ。
    def show
      pdf = RegimenMasterReport.new(params[:id]).generate
      send_data pdf, filename: "regimen-#{params[:id]}.pdf", type: "application/pdf", disposition: "inline"
    end
  end
end
