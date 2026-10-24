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

  describe "form templates (PDF / image backgrounds)" do
    # 1×1 の PNG。幅・高さの検証は属性で行うので中身は最小でよい。
    let(:png) do
      Base64.decode64(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
      )
    end

    def page_param(number)
      { page_number: number, content_type: "image/png", data: Base64.strict_encode64(png),
        width_px: 1240, height_px: 1754, width_pt: 595.28, height_pt: 841.89 }
    end

    def field(attrs = {})
      { id: "f_name", type: "text", label: "患者氏名", page: 1, x: 100, y: 200, w: 300, h: 30,
        font_size: 10.5, align: "left", required: false, initial_expression: "%patientName",
        transfer_kinds: [] }.merge(attrs)
    end

    def form_params(attrs = {})
      {
        kind: "form", code: "11111111-2222-3333-4444-555555555555", name: "同意書",
        file_name: "consent.pdf", content_type: "application/pdf",
        questionnaire_url: "http://fhir-client.local/Questionnaire/document-form/11111111-2222-3333-4444-555555555555",
        questionnaire_version: "1",
        layout: { schema_version: 1, fields: [ field ] },
        pages: [ page_param(1), page_param(2) ]
      }.merge(attrs)
    end

    def create_form!
      post "/admin/document_templates", params: form_params, as: :json
      expect(response).to have_http_status(:created)
      DocumentTemplate.find(response.parsed_body["id"])
    end

    it "creates a form template with pages and layout, keeping the given code" do
      template = create_form!

      body = response.parsed_body
      expect(body["kind"]).to eq("form")
      expect(body["code"]).to eq("11111111-2222-3333-4444-555555555555")
      expect(body["layout"]["fields"].first["id"]).to eq("f_name")
      expect(body["pages"].map { |p| p["page_number"] }).to eq([ 1, 2 ])
      expect(body["pages"].first).not_to have_key("data")
      expect(body["byte_size"]).to eq(png.bytesize * 2)
      expect(template.data).to be_nil
      expect(template.pages.count).to eq(2)
    end

    it "lists form templates without page bodies" do
      create_form!

      get "/admin/document_templates"

      item = response.parsed_body["items"].first
      expect(item["kind"]).to eq("form")
      expect(item["pages"].size).to eq(2)
      expect(item["questionnaire_version"]).to eq("1")
    end

    it "rejects a field outside the page" do
      post "/admin/document_templates",
           params: form_params(layout: { schema_version: 1, fields: [ field(x: 1200, w: 100) ] }),
           as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"].join).to include("はみ出し")
    end

    it "rejects an unknown field type and duplicate ids" do
      post "/admin/document_templates",
           params: form_params(layout: { schema_version: 1, fields: [ field(type: "radio") ] }),
           as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/admin/document_templates",
           params: form_params(layout: { schema_version: 1, fields: [ field, field(x: 0) ] }),
           as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"].join).to include("重複")
    end

    it "rejects a select without options and a field on a missing page" do
      post "/admin/document_templates",
           params: form_params(layout: { schema_version: 1,
                                         fields: [ field(type: "select", initial_expression: nil, transfer_kinds: nil).compact ] }),
           as: :json
      expect(response).to have_http_status(:unprocessable_content)

      post "/admin/document_templates",
           params: form_params(layout: { schema_version: 1, fields: [ field(page: 3) ] }),
           as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "rejects too many pages and a page body that is not an image" do
      stub_const("DocumentTemplate::MAX_PAGES", 1)
      post "/admin/document_templates", params: form_params, as: :json
      expect(response).to have_http_status(:unprocessable_content)

      bad = page_param(1).merge(data: Base64.strict_encode64("not an image"))
      post "/admin/document_templates", params: form_params(pages: [ bad ]), as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "requires a questionnaire canonical for form templates" do
      post "/admin/document_templates", params: form_params(questionnaire_url: nil), as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "returns a page image inline" do
      template = create_form!

      get "/admin/document_templates/#{template.id}/pages/2"

      expect(response).to have_http_status(:ok)
      expect(response.media_type).to eq("image/png")
      expect(response.body.b).to eq(png)
      expect(response.headers["Content-Disposition"]).to include("inline")

      get "/admin/document_templates/#{template.id}/pages/3"
      expect(response).to have_http_status(:not_found)
    end

    it "updates the layout without resending pages" do
      template = create_form!

      patch "/admin/document_templates/#{template.id}",
            params: { layout: { schema_version: 1, fields: [ field(x: 10), field(id: "f_date", type: "date", page: 2,
                                                                                initial_expression: nil, transfer_kinds: nil,
                                                                                date_format: "wareki").compact ] },
                      questionnaire_version: "2" },
            as: :json

      expect(response).to have_http_status(:ok)
      template.reload
      expect(template.pages.count).to eq(2)
      expect(template.fields.size).to eq(2)
      expect(template.questionnaire_version).to eq("2")
    end

    it "replaces the pages and drops the old ones" do
      template = create_form!

      patch "/admin/document_templates/#{template.id}",
            params: { pages: [ page_param(1) ] }, as: :json

      expect(response).to have_http_status(:ok)
      expect(template.reload.pages.pluck(:page_number)).to eq([ 1 ])
      expect(template.byte_size).to eq(png.bytesize)
    end

    it "keeps the old pages when the replacement is invalid" do
      template = create_form!

      patch "/admin/document_templates/#{template.id}",
            params: { pages: [ page_param(2) ] }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(template.reload.pages.count).to eq(2)
    end

    it "does not serve the office file for a form template" do
      template = create_form!

      get "/admin/document_templates/#{template.id}/file"

      expect(response).to have_http_status(:not_found)
    end

    it "deletes the pages with the template" do
      template = create_form!

      delete "/admin/document_templates/#{template.id}"

      expect(response).to have_http_status(:no_content)
      expect(DocumentTemplatePage.count).to eq(0)
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
