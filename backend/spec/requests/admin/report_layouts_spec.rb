require "rails_helper"

RSpec.describe "Admin::ReportLayouts", type: :request do
  let(:valid_tlf) { { version: "0.11.0", items: [] }.to_json }
  let(:valid_params) do
    {
      name: "問診票レイアウト",
      questionnaire_url: "http://example.com/Questionnaire/intake",
      questionnaire_version: "1.0.0",
      tlf: valid_tlf
    }
  end

  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  def create_layout!(attrs = {})
    ReportLayout.create!(valid_params.merge(attrs))
  end

  describe "CRUD (no ADMIN_TOKEN configured)" do
    it "lists layouts without the tlf body" do
      layout = create_layout!

      get "/admin/report_layouts"

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["total"]).to eq(1)
      item = body["items"].first
      expect(item["id"]).to eq(layout.id)
      expect(item["canonical"]).to eq("http://example.com/Questionnaire/intake|1.0.0")
      expect(item["tlf_bytesize"]).to eq(valid_tlf.bytesize)
      expect(item).not_to have_key("tlf")
    end

    it "returns the tlf body on show for re-download" do
      layout = create_layout!

      get "/admin/report_layouts/#{layout.id}"

      expect(response.parsed_body["tlf"]).to eq(valid_tlf)
    end

    it "creates a layout" do
      post "/admin/report_layouts", params: valid_params, as: :json

      expect(response).to have_http_status(:created)
      expect(ReportLayout.count).to eq(1)
    end

    it "rejects an invalid tlf with validation errors" do
      post "/admin/report_layouts", params: valid_params.merge(tlf: "{broken"), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to be_present
    end

    it "rejects a duplicate canonical" do
      create_layout!

      post "/admin/report_layouts", params: valid_params.merge(name: "別名"), as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "updates a layout" do
      layout = create_layout!

      patch "/admin/report_layouts/#{layout.id}", params: { name: "改訂版" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(layout.reload.name).to eq("改訂版")
    end

    it "deletes a layout" do
      layout = create_layout!

      delete "/admin/report_layouts/#{layout.id}"

      expect(response).to have_http_status(:no_content)
      expect(ReportLayout.count).to eq(0)
    end

    it "returns 404 for a missing layout" do
      get "/admin/report_layouts/999999"

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "ADMIN_TOKEN guard" do
    it "rejects unauthenticated requests when the token is configured" do
      with_admin_token("s3cret") do
        get "/admin/report_layouts"

        expect(response).to have_http_status(:unauthorized)
      end
    end

    it "accepts the X-Admin-Token header (no CSRF needed on the header path)" do
      with_admin_token("s3cret") do
        post "/admin/report_layouts", params: valid_params, as: :json,
                                      headers: { "X-Admin-Token" => "s3cret" }

        expect(response).to have_http_status(:created)
      end
    end

    it "rejects a session-authenticated POST without a CSRF token" do
      with_admin_token("s3cret") do
        post "/admin/session", params: { token: "s3cret" }, as: :json
        expect(response).to have_http_status(:ok)

        post "/admin/report_layouts", params: valid_params, as: :json

        expect(response).to have_http_status(:forbidden)
        expect(response.parsed_body["error"]).to eq("invalid_csrf_token")
      end
    end

    it "accepts a session-authenticated POST with the CSRF token" do
      with_admin_token("s3cret") do
        post "/admin/session", params: { token: "s3cret" }, as: :json
        csrf = response.parsed_body["csrf_token"]

        post "/admin/report_layouts", params: valid_params, as: :json,
                                      headers: { "X-CSRF-Token" => csrf }

        expect(response).to have_http_status(:created)
      end
    end
  end
end
