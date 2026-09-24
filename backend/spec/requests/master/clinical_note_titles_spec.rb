require "rails_helper"

RSpec.describe "Master::ClinicalNoteTitles", type: :request do
  def body
    JSON.parse(response.body)
  end

  it "表示順で返す" do
    Master::ClinicalNoteTitle.create!(title: "看護記録", mode: "free", display_order: 20)
    Master::ClinicalNoteTitle.create!(title: "外来診療録", mode: "soap", display_order: 10)

    get "/master/clinical_note_titles"

    expect(body["items"].map { |i| i["title"] }).to eq(%w[外来診療録 看護記録])
  end

  it "作成・更新・削除できる" do
    post "/master/clinical_note_titles",
         params: { title: "入院時記録", mode: "template",
                   template_canonical: "http://example.org/Questionnaire/admit|1.0.0",
                   role_code: "doctor", display_order: 5 }, as: :json
    expect(response).to have_http_status(:created)
    id = body["id"]

    patch "/master/clinical_note_titles/#{id}", params: { title: "入院時診療録" }, as: :json
    expect(Master::ClinicalNoteTitle.find(id)).to have_attributes(title: "入院時診療録", role_code: "doctor")

    delete "/master/clinical_note_titles/#{id}"
    expect(response).to have_http_status(:no_content)
  end

  it "テンプレート形式は既定テンプレートが必須" do
    post "/master/clinical_note_titles", params: { title: "x", mode: "template" }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/clinical_note_titles", params: { title: "x", mode: "bogus" }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "テンプレート以外では既定テンプレートを持たず、空の職種は NULL で保存する" do
    post "/master/clinical_note_titles",
         params: { title: "経過記録", mode: "soap",
                   template_canonical: "http://example.org/Questionnaire/x|1", role_code: "" }, as: :json

    expect(Master::ClinicalNoteTitle.find(body["id"]))
      .to have_attributes(template_canonical: nil, role_code: nil)
  end
end
