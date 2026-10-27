module WaitingBoard
  # 待合表示板の公開 API(docs/waiting-board-design.md §2)。ログインは無く、リンクのトークン
  # (ヘッダ X-Board-Token。パスに置くとリクエストログに残る)で開く。応答に患者を特定できるものは入れない。
  class PublicController < ActionController::API
    # 専用の store に数える(テストと開発の既定の cache_store は null_store で数えられない)。
    RATE_LIMIT_STORE = ActiveSupport::Cache::MemoryStore.new

    rate_limit to: 30, within: 1.minute, by: -> { request.remote_ip }, store: RATE_LIMIT_STORE,
               with: -> { render json: { error: "too_many_requests" }, status: :too_many_requests }

    before_action :load_link
    rescue_from Integrations::FhirStore::UpstreamError, Faraday::ConnectionFailed, Faraday::TimeoutError,
                with: :render_bad_gateway

    def show
      render json: Snapshot.new(@link).call
    end

    private

    def load_link
      @link = WaitingBoardLink.active.find_by_token(request.headers["X-Board-Token"])
      render json: { error: "unauthorized" }, status: :unauthorized unless @link
    end

    def render_bad_gateway(exception)
      render json: { error: "upstream_unavailable (#{exception.class})" }, status: :bad_gateway
    end
  end
end
