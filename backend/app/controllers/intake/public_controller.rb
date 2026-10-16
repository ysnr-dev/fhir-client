module Intake
  # Web 問診の患者向け API(docs/web-intake-design.md §2.2)。ログインは無く、リンクのトークン
  # (ヘッダ X-Intake-Token。パスに置くとリクエストログに残る)で患者を特定する。
  # 個人情報は返さない(患者名も出さない。本人確認は生年月日を入れてもらう)。
  class PublicController < ActionController::API
    # 専用の store に数える(テストと開発の既定の cache_store は null_store で数えられない)。
    RATE_LIMIT_STORE = ActiveSupport::Cache::MemoryStore.new

    rate_limit to: 30, within: 1.minute, by: -> { request.remote_ip }, store: RATE_LIMIT_STORE,
               with: -> { render json: { error: "too_many_requests" }, status: :too_many_requests }

    before_action :load_link
    rescue_from Integrations::FhirStore::UpstreamError, Faraday::ConnectionFailed, Faraday::TimeoutError,
                with: :render_bad_gateway

    # 状態と(照合済みなら)質問票。
    def show
      status = @link.public_status
      body = { status: status, submitted_urls: @link.responses.pending.pluck(:questionnaire_url) }
      if status == "ready"
        store = Integrations::FhirStore.new
        body[:questionnaires] = @link.questionnaire_urls.filter_map { |url| QuestionnaireLoader.load(store, url) }
      end
      render json: body
    end

    def verify
      return render_link_state unless @link.public_status == "verify" || @link.public_status == "ready"

      if @link.verify_birth_date!(params[:birth_date])
        render json: { status: "ready" }
      else
        # 総当たりをわずかに遅らせる(ログインと同じ)。
        sleep 0.2
        render json: { status: @link.locked? ? "locked" : "verify", error: "生年月日が一致しません" }, status: :forbidden
      end
    end

    # 回答。同じ質問票は取込待ちのものを上書きする。
    def create_response
      return render_link_state unless @link.public_status == "ready"

      # リンクは版なしの url で持ち、患者画面は開いた版の canonical(url|version)を送る。url の部分で突き合わせる。
      url = params.require(:questionnaire_url).to_s
      base_url = url.split("|", 2).first
      unless @link.questionnaire_urls.map { |u| u.split("|", 2).first }.include?(base_url)
        return render json: { error: "この質問票はこのリンクの対象ではありません" }, status: :unprocessable_content
      end

      answers = params[:answers]
      answers = answers.respond_to?(:to_unsafe_h) ? answers.to_unsafe_h : answers
      answers = answers.map { |a| a.respond_to?(:to_unsafe_h) ? a.to_unsafe_h : a } if answers.is_a?(Array)
      return render json: { error: "answers は配列で送ってください" }, status: :unprocessable_content unless answers.is_a?(Array)

      record = @link.responses.pending.find { |r| r.questionnaire_url.split("|", 2).first == base_url } ||
               @link.responses.build(questionnaire_url: url)
      record.update!(questionnaire_version: params[:questionnaire_version].presence, answers: answers, submitted_at: Time.current)
      render json: { status: "submitted", submitted_urls: @link.responses.pending.pluck(:questionnaire_url) }, status: :created
    end

    private

    def load_link
      @link = IntakeLink.find_by_token(request.headers["X-Intake-Token"])
      render json: { error: "unauthorized" }, status: :unauthorized unless @link
    end

    def render_link_state
      status = @link.public_status
      http = status == "expired" ? :gone : :forbidden
      render json: { status: status }, status: http
    end

    def render_bad_gateway(exception)
      render json: { error: "upstream_unavailable (#{exception.class})" }, status: :bad_gateway
    end
  end
end
