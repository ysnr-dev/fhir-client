require "rails_helper"

RSpec.describe "Admin::FacilitySettings", type: :request do
  # 管理APIは ADMIN_TOKEN 未設定なら認証なし(後方互換)。CRUD の確認は
  # その状態で行い、認証の確認だけ token を設定して別に行う。
  def without_admin_token
    previous = ENV.delete("ADMIN_TOKEN")
    yield
  ensure
    ENV["ADMIN_TOKEN"] = previous if previous
  end

  describe "GET /admin/facility_settings" do
    it "returns the configured self organization" do
      FacilitySettings.current.update!(self_organization_fhir_id: "org-self")

      without_admin_token { get "/admin/facility_settings" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to include("self_organization_id" => "org-self")
    end
  end

  describe "PATCH /admin/facility_settings" do
    it "stores the self organization id" do
      without_admin_token do
        patch "/admin/facility_settings", params: { self_organization_id: "org-self" }, as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(FacilitySettings.self_organization_id).to eq("org-self")
    end

    it "clears the self organization when given a blank value" do
      FacilitySettings.current.update!(self_organization_fhir_id: "org-self")

      without_admin_token do
        patch "/admin/facility_settings", params: { self_organization_id: "" }, as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to include("self_organization_id" => nil)
      expect(FacilitySettings.self_organization_id).to be_nil
    end
  end

  describe "PATCH /admin/facility_settings (nursing_schedule)" do
    it "stores the nursing schedule without touching the self organization" do
      FacilitySettings.current.update!(self_organization_fhir_id: "org-self")

      without_admin_token do
        patch "/admin/facility_settings",
              params: { nursing_schedule: { daily: { "3" => %w[08:00 13:00 19:00] } } },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["self_organization_id"]).to eq("org-self")
      expect(body["nursing_schedule"]["daily"]["3"]).to eq(%w[08:00 13:00 19:00])
      # 渡していない回数は既定値のまま
      expect(body["nursing_schedule"]["daily"]["2"]).to eq(%w[10:00 18:00])
      expect(body["nursing_schedule"]["interval_start"]).to eq("06:00")
    end

    it "rejects a malformed time" do
      without_admin_token do
        patch "/admin/facility_settings",
              params: { nursing_schedule: { interval_start: "6時" } },
              as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /admin/facility_settings (meal_schedule)" do
    it "stores the meal schedule and fills the rest with defaults" do
      without_admin_token do
        patch "/admin/facility_settings", params: { meal_schedule: { lunch: "11:30" } }, as: :json
      end

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["meal_schedule"]).to eq("breakfast" => "08:00", "lunch" => "11:30", "dinner" => "18:00")
    end

    it "rejects a malformed time" do
      without_admin_token do
        patch "/admin/facility_settings", params: { meal_schedule: { dinner: "夕方" } }, as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /admin/facility_settings (vital_thresholds)" do
    it "stores the thresholds without touching the other settings" do
      FacilitySettings.current.update!(self_organization_fhir_id: "org-self")

      without_admin_token do
        patch "/admin/facility_settings",
              params: { vital_thresholds: { "8310-5" => { high: 38.0 }, "2708-6" => { low: 93 } } },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["self_organization_id"]).to eq("org-self")
      expect(body["vital_thresholds"]["8310-5"]).to eq("high" => 38.0)
      expect(body["vital_thresholds"]["2708-6"]).to eq("low" => 93)
      # 渡していない項目は既定値のまま
      expect(body["vital_thresholds"]["8867-4"]).to eq("low" => 50, "high" => 100)
    end

    it "rejects a non-numeric bound" do
      without_admin_token do
        patch "/admin/facility_settings", params: { vital_thresholds: { "8310-5" => { high: "38度" } } }, as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "with ADMIN_TOKEN configured" do
    it "rejects a request without credentials" do
      ENV["ADMIN_TOKEN"] = "s3cret-admin-passphrase"

      patch "/admin/facility_settings", params: { self_organization_id: "org-self" }, as: :json

      expect(response).to have_http_status(:unauthorized)
    ensure
      ENV.delete("ADMIN_TOKEN")
    end
  end
end
