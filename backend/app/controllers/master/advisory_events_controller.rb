module Master
  # 警告の発火・無視の台帳への書き込み(docs/advisory-design.md §3.2)。フォームのセッション
  # ごとに 1 回、まとめて受ける。誰が無視したかはログイン中の本人で固定する。
  class AdvisoryEventsController < BaseController
    MAX_EVENTS = 200

    # POST /master/advisory_events
    #   { context, session_id, order_reference?, events: [{ key, kind, severity, outcome, reason_code?, reason_text?, occurred_at? }] }
    def create
      events = Array(params[:events]).first(MAX_EVENTS)
      rows = events.map { |event| row_for(event) }
      invalid = rows.find(&:invalid?)
      return render json: { errors: invalid.errors.full_messages }, status: :unprocessable_content if invalid

      if rows.any?
        now = Time.current
        AdvisoryEvent.insert_all(
          rows.map { |row| row.attributes.except("id").merge("created_at" => now) },
          unique_by: %i[session_id advisory_key outcome]
        )
      end
      head :no_content
    end

    private

    def row_for(event)
      attrs = event.respond_to?(:permit) ? event.permit(:key, :kind, :severity, :outcome, :reason_code, :reason_text, :occurred_at) : {}
      AdvisoryEvent.new(
        session_id: params[:session_id].to_s,
        context: params[:context].to_s,
        order_reference: params[:order_reference].presence,
        advisory_key: attrs[:key].to_s,
        kind: attrs[:kind].to_s,
        severity: attrs[:severity].to_s,
        outcome: attrs[:outcome].to_s,
        reason_code: attrs[:reason_code].presence,
        reason_text: attrs[:reason_text].presence,
        occurred_at: attrs[:occurred_at].present? ? Time.zone.parse(attrs[:occurred_at].to_s) : Time.current,
        practitioner_fhir_id: (@user_auth == :none ? nil : current_user&.practitioner_fhir_id),
        user_login_id: login_id
      )
    end

    def login_id
      return nil if @user_auth == :none
      administrator_session? ? UserAuthentication::ADMIN_LOGIN_ID : current_user&.login_id
    end
  end
end
