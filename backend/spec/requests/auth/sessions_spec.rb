require "rails_helper"

RSpec.describe "Auth::Sessions", type: :request do
  let(:admin_token) { "s3cret-admin-passphrase" }

  def with_admin_token(token = admin_token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  def create_practitioner_user(login_id: "tanaka", password: "password123", practitioner_id: "prac-1")
    User.create!(login_id: login_id, password: password, practitioner_fhir_id: practitioner_id)
  end

  def login(login_id, password)
    post "/auth/session", params: { login_id: login_id, password: password }, as: :json
    JSON.parse(response.body)
  end

  describe "when ADMIN_TOKEN is not configured" do
    it "reports the SPA needs no login" do
      with_admin_token(nil) { get "/auth/session" }

      body = JSON.parse(response.body)
      expect(body["authenticated"]).to be(true)
      expect(body["auth_required"]).to be(false)
      expect(body["user"]).to be_nil
    end
  end

  describe "POST /auth/session (administrator)" do
    it "logs in with the admin passphrase and no practitioner" do
      with_admin_token do
        body = login("administrator", admin_token)

        expect(response).to have_http_status(:ok)
        expect(body["authenticated"]).to be(true)
        expect(body["csrf_token"]).to be_present
        expect(body["user"]).to eq(
          "login_id" => "administrator", "practitioner_id" => nil, "administrator" => true
        )
      end
    end

    it "rejects a wrong passphrase" do
      with_admin_token do
        login("administrator", "wrong")

        expect(response).to have_http_status(:unauthorized)
      end
    end

    it "rejects administrator when ADMIN_TOKEN is unset" do
      with_admin_token(nil) do
        login("administrator", "anything")

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "POST /auth/session (practitioner user)" do
    it "logs in with id/password and exposes the linked practitioner" do
      with_admin_token do
        create_practitioner_user

        body = login("tanaka", "password123")

        expect(response).to have_http_status(:ok)
        expect(body["user"]).to eq(
          "login_id" => "tanaka", "practitioner_id" => "prac-1", "administrator" => false
        )
      end
    end

    it "rejects a wrong password" do
      with_admin_token do
        create_practitioner_user

        login("tanaka", "wrong-password")

        expect(response).to have_http_status(:unauthorized)
        expect(JSON.parse(response.body)["error"]).to be_present
      end
    end

    it "rejects an unknown login id" do
      with_admin_token do
        login("nobody", "password123")

        expect(response).to have_http_status(:unauthorized)
      end
    end

    it "invalidates the session when the password is changed" do
      with_admin_token do
        user = create_practitioner_user
        login("tanaka", "password123")

        user.update!(password: "new-password-456")
        get "/auth/session"

        expect(JSON.parse(response.body)["authenticated"]).to be(false)
      end
    end
  end

  describe "session lifetime" do
    it "expires after the TTL" do
      with_admin_token do
        create_practitioner_user
        login("tanaka", "password123")

        travel_to(UserAuthentication::SESSION_TTL.from_now + 1.minute) do
          get "/auth/session"

          expect(JSON.parse(response.body)["authenticated"]).to be(false)
        end
      end
    end
  end

  describe "DELETE /auth/session" do
    it "clears the app session" do
      with_admin_token do
        create_practitioner_user
        login("tanaka", "password123")

        delete "/auth/session"
        expect(JSON.parse(response.body)["authenticated"]).to be(false)

        get "/auth/session"
        expect(JSON.parse(response.body)["authenticated"]).to be(false)
      end
    end

    it "keeps the admin session intact" do
      with_admin_token do
        create_practitioner_user
        post "/admin/session", params: { token: admin_token }, as: :json
        login("tanaka", "password123")

        delete "/auth/session"

        get "/admin/session"
        expect(JSON.parse(response.body)["authenticated"]).to be(true)
      end
    end
  end

  describe "coexistence with the admin login" do
    it "survives an admin login/logout in the same browser session" do
      with_admin_token do
        create_practitioner_user
        login("tanaka", "password123")

        # 管理画面へのログイン(reset_session)後もアプリ本体のログインは残る
        post "/admin/session", params: { token: admin_token }, as: :json
        get "/auth/session"
        expect(JSON.parse(response.body)["authenticated"]).to be(true)

        # 管理画面のログアウトでも残る
        delete "/admin/session"
        get "/auth/session"
        expect(JSON.parse(response.body)["authenticated"]).to be(true)
      end
    end
  end

  describe "authentication enforcement" do
    let(:upstream_base) { ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000") }

    it "rejects /fhir without a session when ADMIN_TOKEN is set" do
      with_admin_token do
        get "/fhir/metadata"

        expect(response).to have_http_status(:unauthorized)
      end
    end

    it "allows /fhir with a logged-in session" do
      with_admin_token do
        create_practitioner_user
        login("tanaka", "password123")
        stub_request(:get, "#{upstream_base}/metadata")
          .to_return(status: 200, body: '{"resourceType":"CapabilityStatement"}',
                     headers: { "Content-Type" => "application/fhir+json" })

        get "/fhir/metadata"

        expect(response).to have_http_status(:ok)
      end
    end

    it "allows /fhir with the admin token header (no CSRF needed)" do
      with_admin_token do
        stub_request(:post, "#{upstream_base}/Patient").to_return(
          status: 201, body: '{"resourceType":"Patient"}',
          headers: { "Content-Type" => "application/fhir+json" }
        )

        post "/fhir/Patient",
          params: '{"resourceType":"Patient"}',
          headers: { "Content-Type" => "application/fhir+json", "X-Admin-Token" => admin_token }

        expect(response).to have_http_status(:created)
      end
    end

    it "requires a CSRF token on session-authenticated non-GET requests" do
      with_admin_token do
        create_practitioner_user
        csrf = login("tanaka", "password123").fetch("csrf_token")

        post "/fhir/Patient",
          params: '{"resourceType":"Patient"}',
          headers: { "Content-Type" => "application/fhir+json" }
        expect(response).to have_http_status(:forbidden)

        stub_request(:post, "#{upstream_base}/Patient").to_return(
          status: 201, body: '{"resourceType":"Patient"}',
          headers: { "Content-Type" => "application/fhir+json" }
        )
        post "/fhir/Patient",
          params: '{"resourceType":"Patient"}',
          headers: { "Content-Type" => "application/fhir+json", "X-CSRF-Token" => csrf }
        expect(response).to have_http_status(:created)
      end
    end

    it "rejects /master and /reports without a session" do
      with_admin_token do
        get "/master/medicines"
        expect(response).to have_http_status(:unauthorized)

        get "/reports/layouts", params: { canonical: "http://example.com/q|1" }
        expect(response).to have_http_status(:unauthorized)
      end
    end

    it "keeps /master open when ADMIN_TOKEN is unset" do
      with_admin_token(nil) do
        get "/master/medicines"

        expect(response).to have_http_status(:ok)
      end
    end
  end
end
