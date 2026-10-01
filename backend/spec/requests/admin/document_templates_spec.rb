require "rails_helper"

RSpec.describe "Admin::DocumentTemplates", type: :request do
  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  let(:docx) { "PK\x03\x04".b + "docx-body".b }
  let(:xlsx) { "PK\x03\x04".b + "xlsx-body".b }

  def create_template(attrs = {})
    DocumentTemplate.create!({ name: "診断書", file_name: "shindansho.docx", data: docx }.merge(attrs))
  end

  describe "CRUD (no ADMIN_TOKEN configured)" do
    it "lists templates in display order without the file body" do
      category = FileCategory.create!(name: "診断書類")
      create_template(name: "診断書", display_order: 2, file_category: category)
      create_template(name: "証明書", display_order: 1, file_name: "shomei.xlsx", data: xlsx)

      get "/admin/document_templates"

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["total"]).to eq(2)
      expect(body["items"].map { |i| i["name"] }).to eq(%w[証明書 診断書])
      expect(body["items"].first).not_to have_key("data")
      expect(body["items"].first["content_type"]).to eq(DocumentTemplate::CONTENT_TYPES[".xlsx"])
      expect(body["items"].last["file_category_code"]).to eq(category.code)
      expect(body["items"].last["file_category_name"]).to eq("診断書類")
    end

    it "filters to active templates" do
      create_template(name: "診断書")
      create_template(name: "旧様式", active: false)

      get "/admin/document_templates", params: { active: "true" }

      expect(response.parsed_body["items"].map { |i| i["name"] }).to eq(%w[診断書])
    end

    it "creates a template from base64 and appends it to the end" do
      create_template(name: "既存", display_order: 5)

      post "/admin/document_templates",
           params: { name: "診断書", file_name: "診断書.DOCX", file_data: Base64.strict_encode64(docx) },
           as: :json

      expect(response).to have_http_status(:created)
      body = response.parsed_body
      expect(body["display_order"]).to eq(6)
      expect(body["code"]).to be_present
      expect(body["byte_size"]).to eq(docx.bytesize)
      expect(body["content_type"]).to eq(DocumentTemplate::CONTENT_TYPES[".docx"])
      expect(DocumentTemplate.find(body["id"]).data.b).to eq(docx)
    end

    it "rejects a file that is not docx or xlsx" do
      post "/admin/document_templates",
           params: { name: "診断書", file_name: "old.doc", file_data: Base64.strict_encode64(docx) },
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to be_present
    end

    it "rejects a body that is not a zip" do
      post "/admin/document_templates",
           params: { name: "診断書", file_name: "a.docx", file_data: Base64.strict_encode64("plain text") },
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "rejects a body over the size limit" do
      stub_const("DocumentTemplate::DATA_MAX_BYTESIZE", 8)

      post "/admin/document_templates",
           params: { name: "診断書", file_name: "a.docx", file_data: Base64.strict_encode64(docx) },
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "rejects a missing file" do
      post "/admin/document_templates", params: { name: "診断書" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "rejects a duplicate name" do
      create_template

      post "/admin/document_templates",
           params: { name: "診断書", file_name: "a.docx", file_data: Base64.strict_encode64(docx) },
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "updates attributes without replacing the file" do
      template = create_template
      category = FileCategory.create!(name: "診断書類")

      patch "/admin/document_templates/#{template.id}",
            params: { name: "診断書(新)", file_category_id: category.id, active: false },
            as: :json

      expect(response).to have_http_status(:ok)
      template.reload
      expect(template.name).to eq("診断書(新)")
      expect(template.file_category).to eq(category)
      expect(template.active).to be(false)
      expect(template.data.b).to eq(docx)
      expect(response.parsed_body["code"]).to eq(template.code)
    end

    it "replaces the file" do
      template = create_template

      patch "/admin/document_templates/#{template.id}",
            params: { file_name: "shomei.xlsx", file_data: Base64.strict_encode64(xlsx) },
            as: :json

      expect(response).to have_http_status(:ok)
      template.reload
      expect(template.data.b).to eq(xlsx)
      expect(template.content_type).to eq(DocumentTemplate::CONTENT_TYPES[".xlsx"])
    end

    it "returns the file body" do
      template = create_template

      get "/admin/document_templates/#{template.id}/file"

      expect(response).to have_http_status(:ok)
      expect(response.body.b).to eq(docx)
      expect(response.media_type).to eq(DocumentTemplate::CONTENT_TYPES[".docx"])
    end

    it "keeps the template when its category is deleted" do
      category = FileCategory.create!(name: "診断書類")
      template = create_template(file_category: category)

      category.destroy!

      expect(template.reload.file_category_id).to be_nil
    end

    it "deletes a template" do
      template = create_template

      delete "/admin/document_templates/#{template.id}"

      expect(response).to have_http_status(:no_content)
      expect(DocumentTemplate.count).to eq(0)
    end

    it "returns 404 for a missing template" do
      get "/admin/document_templates/999999/file"

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "authorization" do
    it "requires a login when ADMIN_TOKEN is configured" do
      with_admin_token("secret") do
        get "/admin/document_templates"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end
end
