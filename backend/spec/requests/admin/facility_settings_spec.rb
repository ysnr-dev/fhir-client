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
      expect(JSON.parse(response.body)).to eq("self_organization_id" => "org-self")
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
      expect(JSON.parse(response.body)).to eq("self_organization_id" => nil)
      expect(FacilitySettings.self_organization_id).to be_nil
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
