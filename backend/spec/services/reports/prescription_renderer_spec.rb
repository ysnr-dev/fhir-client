require "rails_helper"
require "pdf/inspector"

# 同梱レイアウト(PrescriptionReport::LAYOUTS)で実際に PDF が組めることを見る。
# .tlf がイメージから落ちた・プレースホルダー ID がレンダラとずれた、という
# 「発行を押して初めて 500 になる」故障をここで捕まえる。
# 続紙の境界(lines_per_page)は .tlf の処方欄の寸法と対なので、レイアウトを
# 差し替えたときにあふれが truncate で黙って消えないよう、境界も実 PDF で見る。
RSpec.describe Reports::PrescriptionRenderer do
  let(:order) do
    {
      "authoredOn" => "2026-08-20",
      "category" => [
        { "coding" => [{ "system" => PrescriptionReport::SETTING_SYSTEM,
                         "code" => "outpatient", "display" => "外来" }] },
        { "coding" => [{ "system" => PrescriptionReport::PRESCRIPTION_CATEGORY_SYSTEM,
                         "code" => "external", "display" => "院外" }] }
      ],
      "requester" => { "reference" => "Practitioner/dr1", "display" => "児玉 義憲" },
      "extension" => [
        { "url" => PrescriptionReport::ORDER_DEPARTMENT_EXT_URL,
          "valueReference" => { "reference" => "Organization/dept1", "display" => "内科" } }
      ],
      "note" => [{ "text" => "処方箋コメント" }]
    }
  end
  let(:patient) do
    {
      "birthDate" => "1990-01-01",
      "gender" => "male",
      "name" => [{ "family" => "テスト", "given" => ["太郎"] }],
      "identifier" => [{ "value" => "2" }]
    }
  end
  let(:organization) do
    {
      "name" => "テスト病院",
      "address" => [{ "text" => "東京都板橋区板橋1-60-1", "postalCode" => "173-0004" }],
      "telecom" => [{ "system" => "phone", "value" => "03-1234-5678" }],
      "identifier" => [{ "system" => PrescriptionReport::INSTITUTION_NO_SYSTEM,
                         "value" => "1311234567" }]
    }
  end

  def rp(number, medicines:, usage: "１日３回朝昼夕食後　服用", days: 7, count: nil, comment: nil)
    PrescriptionReport::RpGroup.new(
      rp_number: number, usage_name: usage, dose_days: days, dose_count: count,
      usage_comment: comment,
      medicines: medicines.each_with_index.map do |(name, dose, unit), index|
        PrescriptionReport::MedicineLine.new(
          order_in_rp: index + 1, name: name, dose: dose, unit: unit, comment: nil
        )
      end
    )
  end

  def render(key, rps, organization: self.organization)
    layout = PrescriptionReport::LAYOUTS.fetch(key)
    described_class.new(
      layout_path: layout[:path], order: order, patient: patient,
      organization: organization, rps: rps,
      lines_per_page: layout[:lines_per_page], max_cols: layout[:max_cols]
    ).render
  end

  def page_texts(pdf)
    PDF::Inspector::Page.analyze(pdf).pages.map { |page| page[:strings] }
  end

  let(:simple_rps) { [rp(1, medicines: [["【般】ファモチジン散２％", 3, "ｇ"]])] }

  # 様式の見出しなどの静的テキストは ThinReports がスタンプ(Form XObject)で
  # 描くため pdf-inspector の文字列抽出には出ない。ここで検証できるのは
  # text-block に流し込んだ値だけ(スペースも字送りとして消えるので、
  # スペースを含まない断片で照合する)。
  it "produces a PDF from both bundled layouts" do
    %i[external internal].each do |key|
      pdf = render(key, simple_rps)

      expect(pdf).to start_with("%PDF-")
      text = page_texts(pdf).flatten.join
      expect(text).to include("太郎")
      expect(text).to include("【般】ファモチジン散２％")
      expect(text).to include("7日分")
      expect(text).to include("義憲")
      expect(text).to include("テスト病院")
    end
  end

  it "prints the split institution code only on the external layout" do
    external = page_texts(render(:external, simple_rps)).flatten
    internal = page_texts(render(:internal, simple_rps)).flatten

    # 保険医療機関コード 10 桁は 都道府県 2 + 点数表 1 + コード 7 に割って刷る
    # (external だけにある枠)。区分(rx_category)は internal だけにある枠。
    expect(external).to include("13").and include("1234567")
    expect(external.join).not_to include("外来")
    expect(internal.join).not_to include("1234567")
    expect(internal.join).to include("外来")
  end

  it "starts a continuation page when the prescription exceeds the page capacity" do
    %i[external internal].each do |key|
      lines = PrescriptionReport::LAYOUTS.dig(key, :lines_per_page)
      # RP 1 つ = 3 行(見出し・薬品・用法)。枠を必ず超える数の RP を作る。
      rps = (1..lines).map { |i| rp(i, medicines: [["テスト薬#{i}", 1, "錠"]]) }

      pages = page_texts(render(key, rps))

      expect(pages.size).to be > 1
      # あふれた行は続紙に載る(truncate で消えない)。
      expect(pages.flatten.join).to include("テスト薬#{lines}")
      # スペースは抽出時に NBSP になったり字送りとして消えたりするので、除いて照合する。
      expect(pages[0].join.gsub(/[[:space:]]/, "")).to include("1/#{pages.size}")
    end
  end

  it "wraps long medicine names instead of truncating them" do
    long_name = "とても長い医薬品名" * 8 # 全角 72 文字 > 1 行の桁数
    pdf = render(:external, [rp(1, medicines: [[long_name, 1, "錠"]])])

    text = page_texts(pdf).flatten.join
    expect(text.delete("　")).to include(long_name)
  end

  it "renders with blank institution fields when the organization is unknown" do
    pdf = render(:external, simple_rps, organization: nil)

    expect(pdf).to start_with("%PDF-")
    expect(page_texts(pdf).flatten.join).not_to include("テスト病院")
  end
end
