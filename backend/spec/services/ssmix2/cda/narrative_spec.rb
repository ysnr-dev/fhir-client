require "rails_helper"

# FHIR Narrative(XHTML)→ CDA 説明ブロック(docs/ssmix2-export-design.md §12)。
RSpec.describe Ssmix2::Cda::Narrative do
  def render(div)
    images = []
    warnings = []
    counter = Enumerator.new { |y| (1..).each { |n| y << n } }
    builder = Nokogiri::XML::Builder.new(encoding: "UTF-8") do |xml|
      xml.text_ { described_class.new(xml, images: images, warnings: warnings, counter: counter).render(div) }
    end
    plain = Nokogiri::XML::Node::SaveOptions::AS_XML
    [builder.doc.root.children.map { |node| node.to_xml(save_with: plain, encoding: "UTF-8") }.join, images, warnings]
  end

  def xhtml(inner) = "<div xmlns=\"http://www.w3.org/1999/xhtml\">#{inner}</div>"

  it "maps paragraphs, decorations, lists and tables to the NarrativeBlock" do
    text, = render(xhtml(
      '<h2>見出し</h2><p>太字は<strong>B</strong>、斜体は<em>I</em>、下線は<u>U</u>、' \
      '<span style="color: red">色</span>と<s>取り消し</s>と<a href="/patients/1">リンク</a>は文字だけ<br/>改行</p>' \
      "<ul><li><p>項目1</p></li><li>項目2</li></ul><ol><li>一</li></ol><hr/>" \
      '<table><tbody><tr><th colspan="2">H</th></tr><tr><td>1</td><td>2</td></tr></tbody></table><blockquote>引用</blockquote>'
    ))

    expect(text).to eq(
      '<paragraph styleCode="Bold">見出し</paragraph>' \
      '<paragraph>太字は<content styleCode="Bold">B</content>、斜体は<content styleCode="Italics">I</content>、' \
      '下線は<content styleCode="Underline">U</content>、<content>色</content>と<content>取り消し</content>と<content>リンク</content>は文字だけ<br/>改行</paragraph>' \
      '<list listType="unordered"><item><paragraph>項目1</paragraph></item><item>項目2</item></list>' \
      '<list listType="ordered"><item>一</item></list>' \
      '<table><tbody><tr><th colspan="2">H</th></tr><tr><td>1</td><td>2</td></tr></tbody></table><paragraph>引用</paragraph>'
    )
  end

  it "turns embedded images into renderMultiMedia and collects them for observationMedia" do
    text, images, warnings = render(xhtml('<p>前</p><img src="data:image/jpeg;base64,/9j/4AAQ"/><p>後 <img src="https://x/y.png"/></p>'))

    expect(text).to eq('<paragraph>前</paragraph><renderMultiMedia referencedObject="MM1"/><paragraph>後 </paragraph>')
    expect(images.map(&:to_h)).to eq([{ id: "MM1", media_type: "image/jpeg", data: "/9j/4AAQ" }])
    expect(warnings).to eq(["埋め込みでない画像は出力しませんでした: https://x/y.png"])
  end

  it "reads loose HTML and ignores unknown elements, keeping their text" do
    text, = render("<div><p>a<custom>b</custom></p><p>c</p>")
    expect(text).to eq("<paragraph>ab</paragraph><paragraph>c</paragraph>")
    expect(render("")[0]).to eq("")
  end
end
