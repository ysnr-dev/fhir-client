module Reports
  class QuestionnaireResponsePdfsController < BaseController
    # GET /reports/questionnaire_responses/:id/pdf
    # 新規タブでそのまま表示できるよう inline で返す。
    def show
      pdf = QuestionnaireResponseReport.new(params[:id]).generate
      send_data pdf,
                filename: "questionnaire-response-#{params[:id]}.pdf",
                type: "application/pdf",
                disposition: "inline"
    end
  end
end
