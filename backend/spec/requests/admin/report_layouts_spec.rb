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

    it "filters by canonical (url|version)" do
      layout = create_layout!
      create_layout!(questionnaire_version: "2.0.0", name: "別バージョン")

      get "/admin/report_layouts", params: { canonical: layout.canonical }

      body = response.parsed_body
      expect(body["total"]).to eq(1)
      expect(body["items"].first["id"]).to eq(layout.id)
    end

    it "filters by a version-less canonical" do
      versionless = create_layout!(questionnaire_version: "", name: "版なし")
      create_layout!

      get "/admin/report_layouts", params: { canonical: "http://example.com/Questionnaire/intake" }

      body = response.parsed_body
      expect(body["total"]).to eq(1)
      expect(body["items"].first["id"]).to eq(versionless.id)
    end

    it "returns an empty list for an unregistered canonical" do
      create_layout!

      get "/admin/report_layouts", params: { canonical: "http://example.com/Questionnaire/other|1.0.0" }

      expect(response.parsed_body["total"]).to eq(0)
    end

    it "creates a layout" do
      post "/admin/report_layouts", params: valid_params, as: :json

      expect(response).to have_http_status(:created)
      expect(ReportLayout.count).to eq(1)
    end

    it "creates a layout with a mapping and reports mapping_set" do
      mapping = [{ linkId: "item-1", code: "01", show: ["check_1"] }].to_json

      post "/admin/report_layouts", params: valid_params.merge(mapping: mapping), as: :json

      expect(response).to have_http_status(:created)
      expect(response.parsed_body["mapping_set"]).to be(true)
      expect(ReportLayout.last.mapping).to eq(mapping)
    end

    it "returns the mapping body on show" do
      mapping = [{ linkId: "item-1", tlfId: "answer_1" }].to_json
      layout = create_layout!(mapping: mapping)

      get "/admin/report_layouts/#{layout.id}"

      expect(response.parsed_body["mapping"]).to eq(mapping)
    end

    it "rejects an invalid tlf with validation errors" do
      post "/admin/report_layouts", params: valid_params.merge(tlf: "{broken"), as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to be_present
    end

    it "rejects an invalid mapping with validation errors" do
      post "/admin/report_layouts", params: valid_params.merge(mapping: "{broken"), as: :json

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

  # 帳票レイアウトは日常運用で使うため、管理者認証ではなくアプリ本体の
  # ログイン認証(/master・/reports と同じ)で保護する。
  describe "with ADMIN_TOKEN configured" do
    it "rejects reads without credentials" do
      with_admin_token("s3cret") do
        get "/admin/report_layouts"

        expect(response).to have_http_status(:unauthorized)
      end
    end

    it "rejects writes without credentials" do
      with_admin_token("s3cret") do
        post "/admin/report_layouts", params: valid_params, as: :json

        expect(response).to have_http_status(:unauthorized)
      end
    end

    it "allows CRUD with a user login session and CSRF token" do
      with_admin_token("s3cret") do
        post "/auth/session", params: { login_id: "administrator", password: "s3cret" }, as: :json
        csrf_token = response.parsed_body["csrf_token"]

        get "/admin/report_layouts"
        expect(response).to have_http_status(:ok)

        post "/admin/report_layouts", params: valid_params, as: :json,
                                      headers: { "X-CSRF-Token" => csrf_token }
        expect(response).to have_http_status(:created)
      end
    end

    it "allows writes with the header token (no CSRF needed)" do
      with_admin_token("s3cret") do
        post "/admin/report_layouts", params: valid_params, as: :json,
                                      headers: { "X-Admin-Token" => "s3cret" }

        expect(response).to have_http_status(:created)
      end
    end
  end
end
