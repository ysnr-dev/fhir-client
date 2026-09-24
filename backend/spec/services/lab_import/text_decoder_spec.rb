require "rails_helper"

# 判定の順序が要点。ISO-2022-JP は 7bit なので「UTF-8 として妥当」に見えてしまい、
# ESC シーケンスと MSH-18 を先に見ないと化ける。
RSpec.describe LabImport::TextDecoder do
  def msh(charset)
    "MSH|^~\\&|LIS|LAB|HIS|HOSP|20260101120000||ORU^R01^ORU_R01|m1|P|2.5||||||#{charset}\r" \
      "PID|||P001||検査^太郎||19600101|M\r"
  end

  it "BOM 付きは UTF-8 とみなす" do
    result = described_class.decode("\xEF\xBB\xBF".b + msh("UNICODE UTF-8").b)
    expect(result.encoding).to eq("UTF-8")
    expect(result.reason).to eq("bom")
    expect(result.text).to start_with("MSH")
  end

  it "ESC シーケンスがあれば ISO-2022-JP とみなす" do
    result = described_class.decode(msh("").encode("ISO-2022-JP"))
    expect(result.encoding).to eq("ISO-2022-JP")
    expect(result.reason).to eq("escape")
    expect(result.text).to include("検査　太郎".tr("　", "^"))
  end

  it "MSH-18 が ISO IR87 なら ISO-2022-JP として読む" do
    # 日本語が半角 ASCII だけのファイルは ESC シーケンスを持たないため、宣言で判定する。
    result = described_class.decode(msh("~ISO IR87").sub("検査^太郎", "KENSA^TARO").b)
    expect(result.encoding).to eq("ISO-2022-JP")
    expect(result.reason).to eq("msh18")
  end

  it "宣言が無い Shift_JIS は最後の手段として CP932 で読む" do
    result = described_class.decode(msh("").encode("CP932"))
    expect(result.encoding).to eq("CP932")
    expect(result.reason).to eq("fallback")
    expect(result.text).to include("検査")
  end

  it "画面で指定された文字コードを優先する" do
    result = described_class.decode(msh("UNICODE UTF-8").encode("CP932"), requested: "shift_jis")
    expect(result.encoding).to eq("CP932")
    expect(result.reason).to eq("manual")
    expect(result.text).to include("検査")
  end

  it "宣言と中身が食い違うファイルは取り込まず指定を促す" do
    # MSH-18 は UTF-8 なのに中身は CP932。読めた気になって化けたまま取り込むと
    # 保留行の名称が読めず原因も追えないので、ここで止める。
    expect { described_class.decode(msh("UNICODE UTF-8").encode("CP932")) }
      .to raise_error(LabImport::ImportError, /文字コードを判定できません/)
  end

  it "空のファイルは取り込まない" do
    expect { described_class.decode("") }.to raise_error(LabImport::ImportError, /空です/)
  end
end
