require "rails_helper"

RSpec.describe "Reports::DocumentFormPdfs", type: :request do
  let(:png) do
    Base64.decode64(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    )
  end

  def create_form!(fields)
    template = DocumentTemplate.new(
      kind: "form", name: "同意書", file_name: "consent.pdf", content_type: "application/pdf",
      questionnaire_url: "http://fhir-client.local/Questionnaire/document-form/x", questionnaire_version: "1",
      layout: { "schema_version" => 1, "fields" => fields }
    )
    template.pages.build(page_number: 1, content_type: "image/png", data: png,
                         width_px: 1240, height_px: 1754, width_pt: 595.28, height_pt: 841.89)
    template.pages.build(page_number: 2, content_type: "image/png", data: png,
                         width_px: 1240, height_px: 1754, width_pt: 595.28, height_pt: 841.89)
    template.save!
    template
  end

  let(:fields) do
    [
      { "id" => "f_name", "type" => "text", "label" => "氏名", "page" => 1,
        "x" => 100, "y" => 200, "w" => 400, "h" => 40, "font_size" => 12, "align" => "left" },
      { "id" => "f_note", "type" => "textarea", "label" => "所見", "page" => 2,
        "x" => 100, "y" => 300, "w" => 1000, "h" => 400, "font_size" => 10.5, "align" => "left" },
      { "id" => "f_check", "type" => "checkbox", "label" => "同意", "page" => 1,
        "x" => 100, "y" => 400, "w" => 30, "h" => 30, "font_size" => 12, "align" => "center" }
    ]
  end

  describe "POST /reports/document_forms/:template_id/pdf" do
    it "draws the given values over the page images" do
      template = create_form!(fields)

      post "/reports/document_forms/#{template.id}/pdf",
           params: { fields: [ { link_id: "f_name", text: "テスト 太郎" }, { link_id: "f_note", text: "経過良好\n次回受診" },
                               { link_id: "f_check", text: "✓" }, { link_id: "unknown", text: "無視" } ] },
           as: :json

      expect(response).to have_http_status(:ok)
      expect(response.content_type).to eq("application/pdf")
      expect(response.headers["Content-Disposition"]).to include("inline")
      expect(response.body[0, 5]).to eq("%PDF-")
      expect(PDF::Inspector::Page.analyze(response.body).pages.size).to eq(2)
      strings = PDF::Inspector::Text.analyze(response.body).strings.join
      expect(strings).to include("テスト 太郎")
      expect(strings).to include("経過良好")
      expect(strings).to include("✓")
      expect(strings).not_to include("無視")
    end

    it "paints masked fields white even when they are empty" do
      masked = fields.map { |f| f.merge("mask" => true) }
      template = create_form!(masked)

      post "/reports/document_forms/#{template.id}/pdf",
           params: { fields: [ { link_id: "f_name", text: "テスト 太郎" } ] }, as: :json

      expect(response).to have_http_status(:ok)
      expect(PDF::Inspector::Text.analyze(response.body).strings.join).to include("テスト 太郎")
      rectangles = PDF::Inspector::Graphics::Rectangle.analyze(response.body).rectangles
      expect(rectangles.size).to eq(3)
    end

    it "returns 404 for an unknown template and 422 for an office template" do
      post "/reports/document_forms/999999/pdf", params: { fields: [] }, as: :json
      expect(response).to have_http_status(:not_found)

      office = DocumentTemplate.create!(name: "診断書", file_name: "a.docx", data: "PK\x03\x04docx".b)
      post "/reports/document_forms/#{office.id}/pdf", params: { fields: [] }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("not_form_template")
    end
  end
end
