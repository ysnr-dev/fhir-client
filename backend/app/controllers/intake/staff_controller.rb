module Intake
  # Web 問診の職員向け API(docs/web-intake-design.md §2.2)。ログインしていれば誰でも使える。
  class StaffController < ActionController::API
    include UserAuthentication

    before_action :authorize_user!
    before_action :verify_user_csrf!

    rescue_from LinkIssuer::InvalidRequest, with: :render_unprocessable
    rescue_from Integrations::FhirStore::NotFound, with: :render_not_found
    rescue_from Integrations::FhirStore::UpstreamError, with: :render_bad_gateway
    rescue_from Faraday::ConnectionFailed, Faraday::TimeoutError, with: :render_bad_gateway

    # リンクの発行。トークン(URL)はこの応答にだけ出す。
    def create_link
      result = LinkIssuer.new.call(
        appointment_id: params[:appointment_id].presence,
        patient_id: params[:patient_id].presence,
        questionnaire_urls: params[:questionnaire_urls],
        created_by: staff_identity
      )
      render json: {
        id: result.link.id,
        path: "/q/#{result.token}",
        expires_at: result.link.expires_at.iso8601,
        questionnaire_urls: result.link.questionnaire_urls
      }, status: :created
    end

    # 予約ごとの状態(外来一覧の「問診」列)。有効なリンクか回答のあるリンクを予約ごとに 1 つ。
    def links
      ids = params[:appointment_ids].to_s.split(",").map(&:strip).reject(&:blank?).uniq
      links = IntakeLink.where(appointment_fhir_id: ids).includes(:responses).order(:created_at)
      items = links.group_by(&:appointment_fhir_id).map do |appointment_id, list|
        link = list.reverse.find { |l| l.responses.any? } || list.last
        { appointment_fhir_id: appointment_id, status: link.staff_status, expires_at: link.expires_at.iso8601 }
      end
      render json: { items: items }
    end

    # 患者の回答。既定は取込待ちだけ。
    def responses
      status = params[:status].presence || "pending"
      scope = IntakeResponse.joins(:link).where(intake_links: { patient_fhir_id: params.require(:patient_id) })
      scope = scope.where(status: status) unless status == "all"
      render json: { items: scope.includes(:link).order(:submitted_at).map { |r| response_json(r) } }
    end

    # 1 件(取込パネルが answers を読む)。response はコントローラの応答と名前が重なるので避ける。
    def show_response
      render json: response_json(IntakeResponse.includes(:link).find(params[:id]))
    end

    # 取込済み(imported_qr_id 付き)か破棄にする。
    def update_response
      record = IntakeResponse.find(params[:id])
      status = params.require(:status).to_s
      return render json: { error: "status は imported か discarded です" }, status: :unprocessable_content unless %w[imported discarded].include?(status)

      record.update!(
        status: status,
        imported_qr_id: status == "imported" ? params[:imported_qr_id].presence : nil,
        imported_by_id: staff_identity&.dig(:id)
      )
      render json: response_json(record)
    end

    private

    def staff_identity
      user = current_user
      return nil unless user

      { id: user.practitioner_fhir_id, name: user.login_id }
    end

    def response_json(record)
      {
        id: record.id,
        patient_fhir_id: record.link.patient_fhir_id,
        appointment_fhir_id: record.link.appointment_fhir_id,
        questionnaire_url: record.questionnaire_url,
        questionnaire_version: record.questionnaire_version,
        answers: record.answers,
        submitted_at: record.submitted_at.iso8601,
        status: record.status,
        imported_qr_id: record.imported_qr_id
      }
    end

    def render_unprocessable(exception)
      render json: { error: exception.message }, status: :unprocessable_content
    end

    def render_not_found(exception)
      render json: { error: exception.message }, status: :not_found
    end

    def render_bad_gateway(exception)
      render json: { error: "上流サーバーに接続できませんでした (#{exception.class})" }, status: :bad_gateway
    end
  end
end
