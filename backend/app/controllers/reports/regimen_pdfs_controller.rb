module Reports
  class RegimenPdfsController < BaseController
    # GET /reports/regimens/:order_id/plan/pdf?cycle=N
    # 化学療法実施計画書(1 クールぶん)。cycle が無ければ登録済みの最後のクール。
    def plan
      pdf = RegimenReport.new(params[:order_id]).generate_plan(cycle: params[:cycle])
      send_pdf(pdf, "regimen-plan-#{params[:order_id]}.pdf")
    end

    # GET /reports/regimens/:order_id/schedule/pdf
    # 患者向けのスケジュール表(登録済みのクール全部。1 ページ = 1 か月)。
    def schedule
      pdf = RegimenReport.new(params[:order_id]).generate_schedule
      send_pdf(pdf, "regimen-schedule-#{params[:order_id]}.pdf")
    end

    private

    def send_pdf(pdf, filename)
      send_data pdf, filename:, type: "application/pdf", disposition: "inline"
    end
  end
end
