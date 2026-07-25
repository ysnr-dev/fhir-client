require_relative "boot"

require "rails"
# Pick the frameworks you want:
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
# require "active_storage/engine"
require "action_controller/railtie"
# require "action_mailer/railtie"
# require "action_mailbox/engine"
# require "action_text/engine"
require "action_view/railtie"
# require "action_cable/engine"
# require "rails/test_unit/railtie"

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

module Backend
  class Application < Rails::Application
    # Initialize configuration defaults for originally generated Rails version.
    config.load_defaults 8.0

    # Configuration for the application, engines, and railties goes here.
    #
    # These settings can be overridden in specific environments using the files
    # in config/environments, which are processed later.
    #
    # config.time_zone = "Central Time (US & Canada)"
    # config.eager_load_paths << Rails.root.join("extras")

    # Only loads a smaller set of middleware suitable for API only apps.
    # Middleware like session, flash, cookies can be added back manually.
    # Skip views, helpers and assets when generating a new resource.
    config.api_only = true

    # 管理UI(/admin)のログインセッションだけが Cookie を使う。FHIR プロキシ
    # (/fhir)とマスタAPI(/master)はセッションを一切参照しない -- この境界が
    # CSRF の影響範囲を /admin 配下に閉じ込める。path を /admin に限定して
    # 他のパスへは Cookie 自体を送らせない。
    #
    # api_only = true では config.session_store だけでは何も挿入されないので、
    # middleware.use で明示的に積む必要がある。
    #
    # ブラウザから見えるオリジンは常に1つ(開発は Vite proxy、本番は Render
    # static site の rewrite が /admin を API サービスへ中継する)。したがって
    # Cookie は first-party で、SameSite=Lax で足りる。
    config.middleware.use ActionDispatch::Cookies
    config.middleware.use ActionDispatch::Session::CookieStore,
                          key: "_fhir_client_admin_session",
                          path: "/admin",
                          same_site: :lax,
                          httponly: true,
                          secure: Rails.env.production?,
                          # 12時間。秒で書くのは application.rb での
                          # core_ext のロード順に依存しないため。
                          expire_after: 12 * 60 * 60
  end
end
