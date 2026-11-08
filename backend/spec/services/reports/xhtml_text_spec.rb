require "rails_helper"

RSpec.describe Reports::XhtmlText do
  def div(inner) = %(<div xmlns="http://www.w3.org/1999/xhtml">#{inner}</div>)

  it "splits paragraphs and line breaks and drops decorations" do
    html = div(%(<p>08/25 入院 <strong>東3階</strong></p><p>2 行目<br/>改行の後</p>))
    expect(described_class.paragraphs(html)).to eq(["08/25 入院 東3階", "2 行目", "改行の後"])
  end

  it "keeps one blank line for empty paragraphs and trims the ends" do
    html = div(%(<p></p><p>前</p><p></p><p><br/></p><p>後</p><p></p>))
    expect(described_class.paragraphs(html)).to eq(["前", "", "後"])
  end

  it "marks list items and images" do
    html = div(%(<ul><li>頭痛</li><li>発熱</li></ul><ol><li>一</li><li>二</li></ol><p><img src="Binary/1"/>図</p>))
    expect(described_class.paragraphs(html)).to eq(["・頭痛", "・発熱", "1. 一", "2. 二", "［画像］図"])
  end

  it "joins table cells in a row" do
    html = div(%(<table><tr><th>項目</th><td>値</td></tr><tr><td>Hb</td><td>13</td></tr></table>))
    expect(described_class.paragraphs(html)).to eq(["項目　値", "Hb　13"])
  end

  it "returns an empty array for a missing div" do
    expect(described_class.paragraphs(nil)).to eq([])
  end
end
