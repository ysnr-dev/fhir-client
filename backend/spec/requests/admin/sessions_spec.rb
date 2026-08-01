require "rails_helper"

RSpec.describe "Admin::Sessions", type: :request do
  let(:passphrase) { "s3cret-admin-passphrase" }

  def with_admin_token(token = passphrase)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  def login
    post "/admin/session", params: { token: passphrase }, as: :json
    JSON.parse(response.body)
  end

  describe "when ADMIN_TOKEN is not configured" do
    it "reports the SPA needs no login" do
      with_admin_token(nil) { get "/admin/session" }

      body = JSON.parse(response.body)
      expect(body["authenticated"]).to be(true)
      expect(body["auth_required"]).to be(false)
    end
  end

  describe "POST /admin/session" do
    it "rejects a wrong passphrase" do
      with_admin_token do
        post "/admin/session", params: { token: "wrong" }, as: :json

        expect(response).to have_http_status(:unauthorized)
        expect(JSON.parse(response.body)["error"]).to be_present
      end
    end

    it "rejects a blank passphrase" do
      with_admin_token do
        post "/admin/session", params: {}, as: :json

        expect(response).to have_http_status(:unauthorized)
      end
    end

    it "sets an HttpOnly session cookie" do
      with_admin_token do
        body = login

        expect(response).to have_http_status(:ok)
        expect(body["authenticated"]).to be(true)
        expect(body["csrf_token"]).to be_present

        cookie = response.headers["Set-Cookie"]
        cookie = cookie.join("\n") if cookie.is_a?(Array)
        # アプリ本体のログイン(/auth)と共有するセッション(path=/)
        expect(cookie).to include("_fhir_client_session")
        # Rails は属性を小文字で出す(httponly / samesite=lax)
        expect(cookie.downcase).to include("httponly")
        expect(cookie.downcase).to include("samesite=lax")
        expect(cookie.downcase).to include("path=/")
        # パスフレーズそのものは Cookie に載せない
        expect(cookie).not_to include(passphrase)
      end
    end

    it "authorizes subsequent GETs by cookie alone" do
      with_admin_token do
        login

        get "/admin/fhir_connection_settings"

        expect(response).to have_http_status(:ok)
      end
    end
  end

  describe "CSRF protection" do
    it "rejects a cookie-authenticated non-GET without the token" do
      with_admin_token do
        login

        patch "/admin/fhir_connection_settings", params: { base_url: "http://x.example" }, as: :json

        expect(response).to have_http_status(:forbidden)
        expect(JSON.parse(response.body)["error"]).to eq("invalid_csrf_token")
      end
    end

    it "accepts a cookie-authenticated non-GET with the token" do
      with_admin_token do
        csrf = login.fetch("csrf_token")

        patch "/admin/fhir_connection_settings",
          params: { base_url: "http://x.example" }.to_json,
          headers: { "X-CSRF-Token" => csrf, "CONTENT_TYPE" => "application/json" }

        expect(response).to have_http_status(:ok)
      end
    end

    # ヘッダ経路(curl / CI / 既存の運用ツール)は Cookie を使わないので、
    # ブラウザが勝手にリクエストを発行することがない = CSRF の前提が成立しない。
    it "does not require a CSRF token on the header-authenticated path" do
      with_admin_token do
        patch "/admin/fhir_connection_settings",
          params: { base_url: "http://y.example" }.to_json,
          headers: { "X-Admin-Token" => passphrase, "CONTENT_TYPE" => "application/json" }

        expect(response).to have_http_status(:ok)
      end
    end
  end

  describe "session lifetime" do
    it "expires after the TTL" do
      with_admin_token do
        login

        travel_to(Admin::BaseController::SESSION_TTL.from_now + 1.minute) do
          get "/admin/fhir_connection_settings"

          expect(response).to have_http_status(:unauthorized)
        end
      end
    end

    it "is invalidated when ADMIN_TOKEN is rotated" do
      with_admin_token do
        login

        with_admin_token("rotated-passphrase") do
          get "/admin/fhir_connection_settings"

          expect(response).to have_http_status(:unauthorized)
        end
      end
    end
  end

  describe "DELETE /admin/session" do
    it "clears the session" do
      with_admin_token do
        login

        delete "/admin/session"
        expect(JSON.parse(response.body)["authenticated"]).to be(false)

        get "/admin/fhir_connection_settings"
        expect(response).to have_http_status(:unauthorized)
      end
    end
  end
end
