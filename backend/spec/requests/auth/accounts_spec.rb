require "rails_helper"

RSpec.describe "Auth::Accounts", type: :request do
  let(:admin_token) { "s3cret-admin-passphrase" }

  def with_admin_token(token = admin_token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  # ログイン済みセッションで /auth/account を操作するためのヘルパー。
  def login_as_administrator
    post "/auth/session", params: { login_id: "administrator", password: admin_token }, as: :json
    JSON.parse(response.body).fetch("csrf_token")
  end

  def json_headers(csrf)
    { "CONTENT_TYPE" => "application/json", "X-CSRF-Token" => csrf }
  end

  describe "authorization" do
    it "rejects unauthenticated access when ADMIN_TOKEN is set" do
      with_admin_token do
        get "/auth/account", params: { practitioner_id: "prac-1" }

        expect(response).to have_http_status(:unauthorized)
      end
    end

    it "allows access without a session when ADMIN_TOKEN is unset" do
      with_admin_token(nil) do
        get "/auth/account", params: { practitioner_id: "prac-1" }

        expect(response).to have_http_status(:ok)
        expect(JSON.parse(response.body)).to eq("registered" => false, "login_id" => nil)
      end
    end
  end

  describe "PUT /auth/account" do
    it "creates a login account for a practitioner" do
      with_admin_token do
        csrf = login_as_administrator

        put "/auth/account",
          params: { practitioner_id: "prac-1", login_id: "tanaka", password: "password123" }.to_json,
          headers: json_headers(csrf)

        expect(response).to have_http_status(:ok)
        expect(JSON.parse(response.body)).to eq("registered" => true, "login_id" => "tanaka")
        expect(User.find_by(practitioner_fhir_id: "prac-1")).to be_present
      end
    end

    it "updates the login id without changing the password when password is blank" do
      with_admin_token do
        user = User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
        csrf = login_as_administrator

        put "/auth/account",
          params: { practitioner_id: "prac-1", login_id: "tanaka2", password: "" }.to_json,
          headers: json_headers(csrf)

        expect(response).to have_http_status(:ok)
        user.reload
        expect(user.login_id).to eq("tanaka2")
        expect(user.authenticate("password123")).to be_truthy
      end
    end

    it "rejects the reserved login id administrator" do
      with_admin_token do
        csrf = login_as_administrator

        put "/auth/account",
          params: { practitioner_id: "prac-1", login_id: "administrator", password: "password123" }.to_json,
          headers: json_headers(csrf)

        expect(response).to have_http_status(:unprocessable_content)
        expect(JSON.parse(response.body)["errors"].join).to include("予約")
      end
    end

    it "rejects a duplicate login id" do
      with_admin_token do
        User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
        csrf = login_as_administrator

        put "/auth/account",
          params: { practitioner_id: "prac-2", login_id: "tanaka", password: "password123" }.to_json,
          headers: json_headers(csrf)

        expect(response).to have_http_status(:unprocessable_content)
      end
    end

    it "rejects a short password" do
      with_admin_token do
        csrf = login_as_administrator

        put "/auth/account",
          params: { practitioner_id: "prac-1", login_id: "tanaka", password: "short" }.to_json,
          headers: json_headers(csrf)

        expect(response).to have_http_status(:unprocessable_content)
      end
    end
  end

  describe "GET /auth/account" do
    it "returns registration status for a practitioner" do
      with_admin_token do
        User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
        login_as_administrator

        get "/auth/account", params: { practitioner_id: "prac-1" }
        expect(JSON.parse(response.body)).to eq("registered" => true, "login_id" => "tanaka")

        get "/auth/account", params: { practitioner_id: "prac-2" }
        expect(JSON.parse(response.body)).to eq("registered" => false, "login_id" => nil)
      end
    end

    it "returns 400 without practitioner_id" do
      with_admin_token do
        login_as_administrator

        get "/auth/account"

        expect(response).to have_http_status(:bad_request)
      end
    end
  end

  describe "DELETE /auth/account" do
    it "removes the login account (idempotent)" do
      with_admin_token do
        User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
        csrf = login_as_administrator

        delete "/auth/account", params: { practitioner_id: "prac-1" },
                                headers: { "X-CSRF-Token" => csrf }
        expect(response).to have_http_status(:ok)
        expect(User.find_by(practitioner_fhir_id: "prac-1")).to be_nil

        delete "/auth/account", params: { practitioner_id: "prac-1" },
                                headers: { "X-CSRF-Token" => csrf }
        expect(response).to have_http_status(:ok)
      end
    end
  end
end
