require "rails_helper"

RSpec.describe "FacilitySettings", type: :request do
  let(:admin_token) { "s3cret-admin-passphrase" }

  def with_admin_token(token = admin_token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  describe "GET /facility_settings" do
    it "returns nil while the self organization is unset" do
      with_admin_token(nil) { get "/facility_settings" }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["self_organization_id"]).to be_nil
      # 未設定でも看護指示の既定時刻は既定値で返る
      expect(body["nursing_schedule"]).to eq(FacilitySettings::DEFAULT_NURSING_SCHEDULE)
      expect(body["meal_schedule"]).to eq(FacilitySettings::DEFAULT_MEAL_SCHEDULE)
      expect(body["vital_thresholds"]).to eq(FacilitySettings::DEFAULT_VITAL_THRESHOLDS)
      expect(body["water_balance"]).to eq(FacilitySettings::DEFAULT_WATER_BALANCE)
      expect(body["medication_schedule"]).to eq(FacilitySettings::DEFAULT_MEDICATION_SCHEDULE)
    end

    it "returns the configured self organization" do
      FacilitySettings.current.update!(self_organization_fhir_id: "org-self")

      with_admin_token(nil) { get "/facility_settings" }

      expect(JSON.parse(response.body)).to include("self_organization_id" => "org-self")
    end

    it "is readable by a logged-in practitioner user (管理者専用ではない)" do
      with_admin_token do
        User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
        post "/auth/session", params: { login_id: "tanaka", password: "password123" }, as: :json
        expect(response).to have_http_status(:ok)

        get "/facility_settings"

        expect(response).to have_http_status(:ok)
      end
    end

    it "rejects an unauthenticated request when ADMIN_TOKEN is configured" do
      with_admin_token { get "/facility_settings" }

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
