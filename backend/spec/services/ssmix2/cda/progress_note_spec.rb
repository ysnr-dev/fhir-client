require "rails_helper"
require "support/ssmix2_helpers"

# 診療記録 → JAHIS 経過記録構造化記述規約の CDA(docs/ssmix2-export-design.md §12)。
RSpec.describe Ssmix2::Cda::ProgressNote do
  let(:patient) do
    ssmix2_patient.merge(
      "address" => [{ "postalCode" => "422-8033", "state" => "静岡県", "city" => "静岡市", "line" => ["登呂1-3-5"] }],
      "telecom" => [{ "system" => "phone", "value" => "054-000-0000", "use" => "home" }]
    )
  end
  let(:resources) do
    { "Patient/p1" => patient, "Practitioner/doc1" => ssmix2_doctor, "Organization/dept1" => ssmix2_department,
      "Organization/org1" => ssmix2_institution }
  end
  let(:searches) { { ["Organization", { "identifier" => "#{Ssmix2::Fhir::INSTITUTION_NO_SYSTEM}|" }] => [ssmix2_institution] } }
  let(:store) { ssmix2_store(resources, searches: searches) }

  # 版を読んだ結果はキャッシュに残るので、同じ記録を別の前提で組み直す example は context を作り直す。
  def context = @context ||= Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new)

  def reset_context! = @context = nil

  before { ssmix2_enable!(extended: true) }

  def build(composition, method: "PUT", version: nil, id: nil)
    id ||= composition&.dig("id") || "c1"
    version ||= composition&.dig("meta", "versionId")&.to_i
    transaction = ssmix2_transaction(method: method, path: "/Composition/#{id}", request: composition, response: composition)
    written = Ssmix2::Dispatcher::Written.new(method: method, type: "Composition", id: id, version: version, resource: composition)
    described_class.new(context: context, transaction: transaction, written: written).build
  end

  def document(result)
    doc = Nokogiri::XML(result.hl7, &:strict)
    doc.remove_namespaces!
    doc
  end

  it "builds a Progress Note document with the JAHIS header and the SOAP sections" do
    result = build(ssmix2_composition)

    expect(result).to have_attributes(storage: "extended", data_kind: "11506-3", document_folder: "^経過記録^^11506-3^経過記録^LN",
                                      document_name: "経過記録", patient_id: "001234", service_date: "20261104", process: "INS",
                                      department_code: "01")
    expect(result.order_no).to match(/\A\d{15}\z/)
    expect(result.order_no).to eq(Ssmix2::OrderNumber.for("Composition/c1"))
    expect(result.warnings).to be_empty
    expect(result.hl7).to start_with('<?xml version="1.0" encoding="UTF-8"?>')

    doc = document(result)
    root = doc.root
    expect(root.name).to eq("ClinicalDocument")
    expect(Nokogiri::XML(result.hl7).root.namespace.href).to eq("urn:hl7-org:v3")
    expect(doc.at_xpath("/ClinicalDocument/realmCode/@code").value).to eq("JP")
    expect(doc.at_xpath("/ClinicalDocument/typeId/@extension").value).to eq("POCD_HD000040")
    expect(doc.at_xpath("/ClinicalDocument/templateId/@root").value).to eq("1.2.392.200270.3.1")
    expect(doc.at_xpath("/ClinicalDocument/id").to_h).to include("root" => "1.2.392.200250.2.2.1.12219999998", "extension" => "c1.1")
    expect(doc.at_xpath("/ClinicalDocument/code").to_h).to include("code" => "11506-3", "codeSystem" => "2.16.840.1.113883.6.1", "displayName" => "経過記録")
    expect(doc.at_xpath("/ClinicalDocument/title").text).to eq("診療記録")
    expect(doc.at_xpath("/ClinicalDocument/effectiveTime/@value").value).to eq("20261104103000+0900")
    expect(doc.at_xpath("/ClinicalDocument/confidentialityCode").to_h).to include("code" => "N", "codeSystem" => "2.16.840.1.113883.5.25")
    expect(doc.at_xpath("/ClinicalDocument/languageCode/@code").value).to eq("ja-JP")
    expect(doc.at_xpath("/ClinicalDocument/setId").to_h).to include("root" => "1.2.392.200250.2.2.1.12219999998", "extension" => "c1")
    expect(doc.at_xpath("/ClinicalDocument/versionNumber/@value").value).to eq("1")
    expect(doc.at_xpath("/ClinicalDocument/relatedDocument")).to be_nil

    # 患者(共通編 6.3.1): ID のルートは 1.2.392.200250.3.3.1 + "1" + 医療機関コード、氏名は IDE と SYL。
    patient_role = doc.at_xpath("/ClinicalDocument/recordTarget/patientRole")
    expect(patient_role.at_xpath("id").to_h).to include("root" => "1.2.392.200250.3.3.1.12219999998", "extension" => "001234")
    expect(patient_role.at_xpath("addr/streetAddressLine").text).to eq("登呂1-3-5")
    expect(patient_role.at_xpath("addr/postalCode").text).to eq("422-8033")
    expect(patient_role.at_xpath("addr/country").text).to eq("JP")
    expect(patient_role.at_xpath("telecom").to_h).to include("value" => "tel:054-000-0000", "use" => "HP")
    expect(patient_role.xpath("patient/name").map { |n| [n["use"], n.at_xpath("family").text, n.at_xpath("given").text] })
      .to eq([["IDE", "患者", "太郎"], ["SYL", "カンジャ", "タロウ"]])
    expect(patient_role.at_xpath("patient/administrativeGenderCode").to_h).to include("code" => "M", "codeSystem" => "2.16.840.1.113883.5.1")
    expect(patient_role.at_xpath("patient/birthTime/@value").value).to eq("19480405")

    # 作成者は最終更新日時、ID は医籍登録番号。作成システムは 2 つ目の author。
    authors = doc.xpath("/ClinicalDocument/author")
    expect(authors.size).to eq(2)
    expect(authors[0].at_xpath("time/@value").value).to eq("20261104103512+0900")
    expect(authors[0].at_xpath("assignedAuthor/id").to_h).to include("root" => "1.2.392.200250.3.3.2.12219999998", "extension" => "220")
    expect(authors[0].at_xpath("assignedAuthor/assignedPerson/name[@use='IDE']/family").text).to eq("医師")
    expect(authors[0].at_xpath("assignedAuthor/representedOrganization/name").text).to eq("テスト病院")
    expect(authors[1].at_xpath("assignedAuthor/id/@nullFlavor").value).to eq("NI")
    expect(authors[1].at_xpath("assignedAuthor/assignedAuthoringDevice/manufacturerModelName").text).to eq("HIS123")

    custodian = doc.at_xpath("/ClinicalDocument/custodian/assignedCustodian/representedCustodianOrganization")
    expect(custodian.at_xpath("id/@root").value).to eq("1.2.392.200250.2.2.1.12219999998")
    expect(custodian.at_xpath("name").text).to eq("テスト病院")
    expect(custodian.at_xpath("telecom/@value").value).to eq("tel:054-000-1111")
    expect(custodian.at_xpath("addr/streetAddressLine").text).to eq("登呂1-3-5")

    legal = doc.at_xpath("/ClinicalDocument/legalAuthenticator")
    expect(legal.at_xpath("time/@value").value).to eq("20261104103500+0900")
    expect(legal.at_xpath("signatureCode/@code").value).to eq("S")
    expect(legal.at_xpath("assignedEntity/id/@extension").value).to eq("220")

    event = doc.at_xpath("/ClinicalDocument/documentationOf/serviceEvent")
    expect(event["classCode"]).to eq("PCPR")
    expect(event.at_xpath("effectiveTime/low/@value").value).to eq("20261104103000+0900")
    expect(event.at_xpath("performer/assignedEntity/assignedPerson/name/family").text).to eq("医師")

    # ボディ: プロブレム + S / O / A と、無い「治療計画」は nullFlavor="NI" で明示する(規約 4.1.1)。
    sections = doc.xpath("/ClinicalDocument/component/structuredBody/component/section")
    expect(sections.map { |s| s.at_xpath("code/@code").value }).to eq(%w[11450-4 61150-9 61149-1 51848-0 18776-5])
    expect(sections[0].at_xpath("templateId").to_h).to include("root" => "2.16.840.1.113883.10.20.22.2.5.1", "extension" => "2015-08-01")
    expect(sections[0].xpath("text/list/item").map(&:text)).to eq(["#1 高血圧症"])
    expect(sections[1].at_xpath("templateId/@root").value).to eq("2.16.840.1.113883.10.20.21.2.2")
    expect(sections[1].at_xpath("code/@displayName").value).to eq("Subjective")
    expect(sections[1].at_xpath("title").text).to eq("主観的情報(S)")
    expect(sections[1].at_xpath("text/paragraph").to_xml).to eq('<paragraph>頭痛が<content styleCode="Bold">続く</content></paragraph>')
    expect(sections[2].at_xpath("text/renderMultiMedia/@referencedObject").value).to eq("MM1")
    media = sections[2].at_xpath("entry/observationMedia")
    expect(media.to_h).to include("ID" => "MM1", "classCode" => "OBS", "moodCode" => "EVN")
    expect(media.at_xpath("value").to_h).to include("mediaType" => "image/png", "representation" => "B64")
    expect(media.at_xpath("value").text).to eq("iVBORw0KGgo=")
    expect(sections[4]["nullFlavor"]).to eq("NI")
    expect(sections[4].at_xpath("templateId").to_h).to include("root" => "2.16.840.1.113883.10.20.22.2.10", "extension" => "2014-06-09")
    expect(sections[4].at_xpath("title").text).to eq("治療計画")
    expect(sections[4].at_xpath("text").children).to be_empty

    contents = result.files.sole
    expect(contents["name"]).to eq("_contents.xml")
    contents_xml = Nokogiri::XML(Base64.strict_decode64(contents["body_base64"]), &:strict)
    expect(contents_xml.root.name).to eq("Contents")
    expect(contents_xml.root.to_h).to include("createVendor" => "HIS123", "description" => "経過記録", "createDateTime" => "2026-11-04T10:30:12+09:00")
    expect(contents_xml.at_xpath("/Contents/Document").to_h).to include("name" => "HL7CDA.xml", "mime" => "text/x-cda-r2+xml", "description" => "経過記録")
  end

  it "puts nursing notes in the 看護記録 folder and accepts the single assessment-and-plan section" do
    composition = ssmix2_composition(nursing: true, sections: [ssmix2_note_section("51847-2", "<p>A/P</p>")])
    result = build(composition)

    expect(result).to have_attributes(data_kind: "28623-7", document_folder: "^看護記録^^28623-7^看護記録^LN", document_name: "看護記録")
    sections = document(result).xpath("//section")
    expect(sections.map { |s| s.at_xpath("code/@code").value }).to eq(%w[51847-2])
    expect(sections.map { |s| s["nullFlavor"] }).to eq([nil])
  end

  it "treats a consult reply as a progress note and writes sections of unknown codes as additional documentation" do
    composition = ssmix2_composition(type: "11488-4", sections: [ssmix2_note_section("99999-9", "<p>x</p>", title: "退院時経過")])
    result = build(composition)

    expect(document(result).at_xpath("/ClinicalDocument/code/@code").value).to eq("11506-3")
    sections = document(result).xpath("//section")
    expect(sections.map { |s| s.at_xpath("code/@code").value }).to eq(%w[77599-9 51848-0 18776-5])
    expect(sections[0].at_xpath("title").text).to eq("退院時経過")
    expect(result.warnings).to include(a_string_matching(/規約に無いセクション\(99999-9\)/))
  end

  it "skips drafts, discharge summaries and anything while the extended storage is off" do
    expect(build(ssmix2_composition(status: "preliminary"), method: "POST")).to be_nil
    expect(build(ssmix2_composition(type: "18842-5"))).to be_nil

    ssmix2_enable!(extended: false)
    expect(build(ssmix2_composition)).to be_nil
  end

  it "replaces the previous version on amendment" do
    result = build(ssmix2_composition(status: "amended", version: 3))

    doc = document(result)
    expect(doc.at_xpath("/ClinicalDocument/id/@extension").value).to eq("c1.3")
    expect(doc.at_xpath("/ClinicalDocument/versionNumber/@value").value).to eq("3")
    parent = doc.at_xpath("/ClinicalDocument/relatedDocument[@typeCode='RPLC']/parentDocument")
    expect(parent.at_xpath("id/@extension").value).to eq("c1.2")
    expect(parent.at_xpath("setId/@extension").value).to eq("c1")
    expect(parent.at_xpath("versionNumber/@value").value).to eq("2")
  end

  it "cancels the document when a final note goes back to draft, using the exported version" do
    resources["Composition/c1/_history/1"] = ssmix2_composition(status: "final", version: 1)
    result = build(ssmix2_composition(status: "preliminary", version: 2))

    expect(result.process).to eq("DEL")
    expect(document(result).at_xpath("/ClinicalDocument/id/@extension").value).to eq("c1.2")
    expect(result.order_no).to eq(Ssmix2::OrderNumber.for("Composition/c1"))

    # 前の版も下書きなら何も出さない。
    reset_context!
    resources["Composition/c1/_history/1"] = ssmix2_composition(status: "preliminary", version: 1)
    expect(build(ssmix2_composition(status: "preliminary", version: 2))).to be_nil
  end

  it "cancels the document on DELETE from the last version in the history" do
    searches[["Composition/c1/_history", {}]] = [ssmix2_composition(status: "final", version: 1), ssmix2_composition(status: "amended", version: 2)]
    result = build(nil, method: "DELETE", id: "c1")

    expect(result).to have_attributes(process: "DEL", data_kind: "11506-3", patient_id: "001234", service_date: "20261104")
    expect(document(result).at_xpath("/ClinicalDocument/versionNumber/@value").value).to eq("2")

    searches[["Composition/c1/_history", {}]] = [ssmix2_composition(status: "preliminary", version: 1)]
    expect(build(nil, method: "DELETE", id: "c1")).to be_nil
  end

  it "falls back to names and nullFlavor when the practitioner and the institution cannot be read" do
    resources.delete("Practitioner/doc1")
    resources.delete("Organization/org1")
    searches.clear
    result = build(ssmix2_composition)

    doc = document(result)
    author = doc.at_xpath("/ClinicalDocument/author/assignedAuthor")
    expect(author.at_xpath("id/@nullFlavor").value).to eq("NI")
    expect(author.at_xpath("assignedPerson/name/family").text).to eq("医師 一郎")
    custodian = doc.at_xpath("//representedCustodianOrganization")
    expect(custodian.at_xpath("name").text).to eq("2219999998")
    expect(custodian.at_xpath("telecom/@nullFlavor").value).to eq("NI")
    expect(custodian.at_xpath("addr/@nullFlavor").value).to eq("NI")
    expect(result.warnings).to include(a_string_matching(/医療従事者が読めない/), a_string_matching(/自院の Organization が読めない/))
  end
end
