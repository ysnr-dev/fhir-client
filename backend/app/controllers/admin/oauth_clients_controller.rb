module Admin
  # 上流 FHIR サーバーの管理API(/admin/oauth_clients)への中継。
  #
  # ブラウザから上流を直接叩けない(上流は CORS を意図的に無効化し、
  # Cross-Origin-Resource-Policy: same-origin も付けている)ので、ここで
  # サーバー間中継する。
  class OauthClientsController < BaseController
    include UpstreamAdminRelay

    UPSTREAM_PATH = "/admin/oauth_clients".freeze
    # 上流の client_id は UUID。パス組み立てに使う前に形を検証する
    # (FhirGateway#forward の意図的に任意な path: とは違い、ここは常に
    #  サーバー側リテラル + 検証済み id しか組み立てない)。
    ID_PATTERN = /\A[0-9a-fA-F-]{1,64}\z/

    before_action :require_admin_auth_configured!

    def index
      relay(:get, UPSTREAM_PATH)
    end

    def create
      # permit で作り直さず生ボディを透過させる。上流の検証を唯一の真実とし、
      # 古い permit リストでフィールドが黙って落ちる事故を防ぐ。
      relay(:post, UPSTREAM_PATH, body: request.raw_post)
    end

    def destroy
      return render_not_found unless params[:id].to_s.match?(ID_PATTERN)

      relay(:delete, "#{UPSTREAM_PATH}/#{params[:id]}")
    end

    private

    # OAuth クライアントを発行・削除できる画面が無認証で開いていてはいけない。
    # 起動時チェックにできないのは、管理トークンが DB にある可能性があるため
    # (初期化子からは見えない)。既存の設定画面の後方互換はそのまま残すので、
    # このガードはこのコントローラだけに置く。
    def require_admin_auth_configured!
      return unless Rails.env.production?
      return if ENV["ADMIN_TOKEN"].present?

      render json: { error: "ADMIN_TOKEN が未設定のため、この操作は本番環境で無効です" },
             status: :service_unavailable
    end
  end
end
