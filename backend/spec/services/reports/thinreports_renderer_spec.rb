require "rails_helper"

RSpec.describe Reports::ThinreportsRenderer do
  # 1x1 の赤 PNG
  PNG_1PX = Base64.decode64(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  )

  let(:layout) do
    ReportLayout.new(
      name: "テスト帳票",
      questionnaire_url: "http://example.com/Questionnaire/intake",
      questionnaire_version: "1.0.0",
      tlf: Rails.root.join("spec/fixtures/files/questionnaire_response_layout.tlf").read
    )
  end

  let(:questionnaire) do
    {
      "resourceType" => "Questionnaire",
      "title" => "初診時問診票",
      "item" => [
        { "linkId" => "chief-complaint", "type" => "string", "text" => "主訴" },
        {
          "linkId" => "body/temp", "type" => "decimal", "text" => "体温",
          "extension" => [
            { "url" => "http://hl7.org/fhir/StructureDefinition/questionnaire-unit",
              "valueCoding" => { "code" => "Cel", "display" => "℃" } }
          ]
        },
        { "linkId" => "symptom.note", "type" => "text", "text" => "備考" },
        {
          "linkId" => "meds", "type" => "group", "text" => "服用中の薬", "repeats" => true,
          "item" => [{ "linkId" => "med-name", "type" => "string", "text" => "薬剤名" }]
        },
        { "linkId" => "schema-body", "type" => "display", "text" => "シェーマ" }
      ]
    }
  end

  let(:response) do
    {
      "resourceType" => "QuestionnaireResponse",
      "id" => "qr-1",
      "status" => "completed",
      "authored" => "2026-07-30T01:23:00Z",
      "contained" => [{ "resourceType" => "Practitioner", "id" => "practitioner",
                        "name" => [{ "text" => "医師 太郎" }] }],
      "identifier" => { "value" => "1310000001^P001^uuid-1" },
      "item" => [
        { "linkId" => "chief-complaint", "text" => "主訴",
          "answer" => [{ "valueString" => "頭痛" }] },
        { "linkId" => "body/temp", "text" => "体温",
          "answer" => [{ "valueDecimal" => 37.2 }] },
        { "linkId" => "meds", "text" => "服用中の薬",
          "item" => [{ "linkId" => "med-name", "text" => "薬剤名",
                       "answer" => [{ "valueString" => "ロキソニン" }] }] },
        { "linkId" => "meds", "text" => "服用中の薬",
          "item" => [{ "linkId" => "med-name", "text" => "薬剤名",
                       "answer" => [{ "valueString" => "ムコスタ" }] }] },
        { "linkId" => "schema-body", "text" => "シェーマ",
          "extension" => [
            { "url" => "http://fhir-client.local/StructureDefinition/questionnaire-response-annotated-image",
              "valueAttachment" => { "contentType" => "image/png", "url" => "Binary/bin-1" } }
          ] }
      ]
    }
  end

  let(:patient) do
    {
      "resourceType" => "Patient",
      "id" => "pat-1",
      "identifier" => [{ "value" => "P001" }],
      "name" => [
        { "extension" => [{ "url" => "http://hl7.org/fhir/StructureDefinition/iso21090-EN-representation",
                            "valueCode" => "IDE" }],
          "family" => "テスト", "given" => ["太郎"] },
        { "extension" => [{ "url" => "http://hl7.org/fhir/StructureDefinition/iso21090-EN-representation",
                            "valueCode" => "SYL" }],
          "family" => "テスト", "given" => ["タロウ"] }
      ],
      "gender" => "male",
      "birthDate" => "1980-07-31"
    }
  end

  def render(images: { "bin-1" => PNG_1PX })
    described_class.new(
      layout: layout,
      questionnaire: questionnaire,
      response: response,
      patient: patient,
      images: images
    ).render
  end

  def rendered_strings(pdf)
    PDF::Inspector::Text.analyze(pdf).strings
  end

  it "generates a PDF" do
    expect(render[0, 5]).to eq("%PDF-")
  end

  it "prints answers, units, meta placeholders and repeated items" do
    strings = rendered_strings(render)

    expect(strings).to include("頭痛")                # 回答値
    # フォント切替でテキストが分割されることがあるため連結して判定する。
    expect(strings.join).to include("37.2 ℃")        # 数値 + 単位
    expect(strings).to include("テスト 太郎")          # pt_name(漢字 IDE)
    expect(strings).to include("2026/07/30 10:23")   # qr_authored(JST 変換)
    expect(strings).to include("ロキソニン")           # 繰り返し 1 回目 → med_name
    expect(strings).to include("ムコスタ")             # 繰り返し 2 回目 → med_name_2
  end

  it "blanks layout placeholders that have no answer" do
    # symptom.note は未回答なので、レイアウトのデザイン時初期値が残らない。
    strings = rendered_strings(render)
    expect(strings.join).not_to include("デザイン初期値")
  end

  it "ignores answers that have no placeholder in the layout" do
    response["item"] << { "linkId" => "not-in-layout", "answer" => [{ "valueString" => "余分" }] }
    questionnaire["item"] << { "linkId" => "not-in-layout", "type" => "string" }

    expect { render }.not_to raise_error
    expect(rendered_strings(render).join).not_to include("余分")
  end

  it "renders without images when the annotation binary is missing" do
    expect { render(images: {}) }.not_to raise_error
  end

  it "raises IdCollision when converted linkIds collide" do
    questionnaire["item"] << { "linkId" => "chief.complaint", "type" => "string" }

    expect { render }.to raise_error(Reports::ItemIdMapper::IdCollision)
  end
end
