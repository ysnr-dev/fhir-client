module Integrations
  module Cds
    # CDS Hooks の呼び出し窓口(docs/cds-hooks-design.md §2.2)。アプリ本体のログイン認証。
    #
    # カードの取得は失敗しても 200 で空を返す(提供元ごとの状態は services に残す)。
    # 判断支援が落ちていることでカルテを開けなくしない。
    class HooksController < ActionController::API
      include UserAuthentication

      before_action :authorize_user!
      before_action :verify_user_csrf!

      OUTCOMES = %w[overridden].freeze

      # POST /integrations/cds/patient_view {patient_id, encounter_id?}
      def patient_view
        practitioner_id = current_user&.practitioner_fhir_id
        if practitioner_id.blank?
          return render json: { cards: [], services: [], skipped: "practitioner_required" }
        end

        patient_id = params[:patient_id].to_s.strip
        return render json: { error: "patient_id is required" }, status: :bad_request if patient_id.blank?

        result = PatientView.new.call(
          patient_id: patient_id, practitioner_id: practitioner_id,
          encounter_id: params[:encounter_id].to_s.strip.presence
        )
        render json: { cards: result.cards, services: result.services }
      end

      # POST /integrations/cds/feedback {service_id, service, card, outcome, override_reason?, user_comment?}
      #
      # サービス側の失敗は 204 のまま(ログに残る)。無視した事実はカードを閉じた時点で
      # 画面の上では確定していて、サービスに届かなかったからといって戻す意味が無い。
      def feedback
        provider = CdsService.enabled.find_by(id: params[:service_id])
        return render json: { error: "not_found" }, status: :not_found unless provider

        service = params[:service].to_s.strip
        card = params[:card].to_s.strip
        outcome = params[:outcome].to_s
        unless service.match?(/\A[\w.-]+\z/) && card.present? && OUTCOMES.include?(outcome)
          return render json: { error: "service, card and outcome are required" }, status: :bad_request
        end

        entry = { "card" => card, "outcome" => outcome, "outcomeTimestamp" => Time.current.utc.iso8601 }
        reason = params[:override_reason]
        if reason.respond_to?(:[]) && reason[:code].present?
          entry["overrideReason"] = {
            "reason" => { "code" => reason[:code].to_s, "system" => reason[:system].presence }.compact,
            "userComment" => params[:user_comment].presence
          }.compact
        end

        begin
          Client.new(provider).feedback(service, { "feedback" => [entry] })
        rescue Integrations::Error => e
          Rails.logger.warn("[cds_hooks] feedback failed: #{e.message}")
        end
        head :no_content
      end
    end
  end
end
