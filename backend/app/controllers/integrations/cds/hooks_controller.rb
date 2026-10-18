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
      # draftOrders に載せてよい型と件数。処方フォームの 1 オーダーぶんで足りる上限。
      DRAFT_ORDER_TYPES = %w[MedicationRequest].freeze
      DRAFT_ORDER_LIMIT = 100

      # POST /integrations/cds/patient_view {patient_id, encounter_id?}
      def patient_view
        invoke("patient-view")
      end

      # POST /integrations/cds/order_select {patient_id, encounter_id?, draft_orders, selections}
      def order_select
        draft_orders, error = draft_orders_param
        return render json: { error: error }, status: :bad_request if error

        ids = draft_orders["entry"].map { |entry| "#{entry.dig('resource', 'resourceType')}/#{entry.dig('resource', 'id')}" }
        selections = Array(params[:selections]).map(&:to_s)
        if selections.empty? || (selections - ids).any?
          return render json: { error: "selections must name orders in draft_orders" }, status: :bad_request
        end

        invoke("order-select", "selections" => selections, "draftOrders" => draft_orders)
      end

      # POST /integrations/cds/order_sign {patient_id, encounter_id?, draft_orders}
      def order_sign
        draft_orders, error = draft_orders_param
        return render json: { error: error }, status: :bad_request if error

        invoke("order-sign", "draftOrders" => draft_orders)
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

      private

      # 紐づく医療者が無いログイン(administrator・認証なし)では呼ばない(context.userId が決まらない)。
      def invoke(hook, extra_context = {})
        practitioner_id = current_user&.practitioner_fhir_id
        if practitioner_id.blank?
          return render json: { cards: [], services: [], skipped: "practitioner_required" }
        end

        patient_id = params[:patient_id].to_s.strip
        return render json: { error: "patient_id is required" }, status: :bad_request if patient_id.blank?

        result = Invocation.new(hook: hook).call(
          patient_id: patient_id, practitioner_id: practitioner_id,
          encounter_id: params[:encounter_id].to_s.strip.presence, extra_context: extra_context
        )
        render json: { cards: result.cards, services: result.services }
      end

      # draftOrders は画面が組んだ未保存のオーダー(Bundle)。サービスへそのまま渡すので、
      # 形と型と件数だけ確かめる(患者が違うオーダーを混ぜさせない)。
      # Returns [bundle, nil] or [nil, error].
      def draft_orders_param
        raw = params[:draft_orders]
        bundle = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw
        return [nil, "draft_orders must be a Bundle"] unless bundle.is_a?(Hash) && bundle["resourceType"] == "Bundle"

        entries = bundle["entry"]
        return [nil, "draft_orders must have entries"] unless entries.is_a?(Array) && entries.any?
        return [nil, "draft_orders has too many entries"] if entries.size > DRAFT_ORDER_LIMIT

        subject = "Patient/#{params[:patient_id].to_s.strip}"
        entries.each do |entry|
          resource = entry.is_a?(Hash) ? entry["resource"] : nil
          return [nil, "draft_orders entries must be MedicationRequest"] unless
            resource.is_a?(Hash) && DRAFT_ORDER_TYPES.include?(resource["resourceType"]) && resource["id"].present?
          return [nil, "draft_orders must be for the patient"] unless resource.dig("subject", "reference") == subject
        end

        [bundle.deep_stringify_keys, nil]
      end
    end
  end
end
