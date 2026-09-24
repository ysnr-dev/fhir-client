require "rails_helper"

# ORU^R01(ファイル転送型の正式形)と OUL^R22(会話型)の両方を同じ状態機械で読む。
# 違いは SPM が群の頭に来るか尻に来るかだけ、という前提を固定する。
RSpec.describe LabImport::Hl7Parser do
  def parse(text)
    described_class.new(text)
  end

  let(:oru) do
    <<~HL7.gsub("\n", "\r\n")
      MSH|^~\\&|LIS|LAB|HIS|HOSP|20260912093000||ORU^R01^ORU_R01|mn768|P|2.5||||||UNICODE UTF-8
      PID|||P0001||検査^太郎^^^^^L^I~ケンサ^タロウ^^^^^L^P||19600102|M
      PV1||I|01^^^^^C
      ORC|SC|0523001|123456701^LAB|0523001|CM
      OBR|1|0523001|123456701^LAB|3D0450000019204^HbA1c^JC10|||20260910143000|||||||||0001^内科^二郎||||||20260912|2000^YEN|LAB|F
      NTE|1||総合所見です
      OBX|1|NM|3D0450000019204^HbA1c^JC10||5.5|%|4.6-6.2|H||N|F|||20260912091500|LAB
      NTE|1||溶血あり\\.br\\再検
      SPM|1|00076787001||023^血清^JC10|||||||||||||20260910143000
    HL7
  end

  it "ORU は ORC → OBR → OBX の順に読み、後ろの SPM をその群に付ける" do
    message = parse(oru).parse

    expect(message.message_type).to eq("ORU^R01")
    expect(message.source).to eq("LAB")
    expect(message.control_id).to eq("mn768")
    expect(message.sent_at).to eq(Time.find_zone!("Asia/Tokyo").local(2026, 9, 12, 9, 30, 0))
    expect(message.reports.size).to eq(1)

    report = message.reports.first
    expect(report.patient.number).to eq("P0001")
    expect(report.patient.name).to eq("検査　太郎")
    expect(report.patient.birth_date).to eq(Date.new(1960, 1, 2))
    expect(report.patient.sex).to eq("M")
    expect(report.patient.setting).to eq("inpatient")
    expect(report.placer_order_number).to eq("0523001")
    expect(report.filler_order_number).to eq("123456701")
    expect(report.status).to eq("F")
    expect(report.reported_at).to eq(Time.find_zone!("Asia/Tokyo").local(2026, 9, 12))
    expect(report.comments).to eq(["総合所見です"])
    expect(report.specimens.first.ids).to eq(["00076787001"])
    expect(report.specimens.first.material_name).to eq("血清")

    observation = report.observations.first
    expect(observation.code).to eq("3D0450000019204")
    expect(observation.jlac10).to eq("3D0450000019204")
    expect(observation.value).to eq("5.5")
    expect(observation.unit).to eq("%")
    expect(observation.reference_range).to eq("4.6-6.2")
    expect(observation.abnormal_flag).to eq("H")
    expect(observation.status).to eq("F")
    # \.br\ は改行に戻す。NTE は直前が OBX なので項目コメントになる。
    expect(observation.notes).to eq(["溶血あり\n再検"])
  end

  it "採取日時をタイムゾーン無しの現地時刻(JST)として読む" do
    report = parse(oru).parse.reports.first
    expect(report.collected_at).to eq(Time.find_zone!("Asia/Tokyo").local(2026, 9, 10, 14, 30, 0))
    expect(report.observations.first.observed_at)
      .to eq(Time.find_zone!("Asia/Tokyo").local(2026, 9, 12, 9, 15, 0))
  end

  let(:oul) do
    <<~HL7.gsub("\n", "\r")
      MSH|^~\\&|AM|IHE-J|LD|IHE-J|20260912171021||OUL^R22^OUL_R22|20260912171021|P|2.5
      PID|||P0001||検査^太郎||19600102|M
      PV1||O|01
      SPM|1|00076787001||023^血清^JC10|||||||||||||20260910143000
      SAC|||00076787001
      OBX|1|ST|SPEC^検体状態^99S01||溶血|||||F
      OBR|1|ord0001|f0001|3C015000002327201^クレアチニン^JC10|||20260910143000
      ORC|SC|ord0001|||CM
      TQ1|1||||||20260910||R
      OBX|1|NM|3C015000002327201^クレアチニン^JC10||1.00|mg/dl|0.61-1.04||||F
      OBR|2|ord0002|f0002|8A025000009827129^Ccr^JC10|||20260910143000
      ORC|SC|ord0002|||CM
      OBX|1|NM|8A025000009827129^Ccr^JC10||107.2|1^L/day^99U01|93.0-238.0||||F
      SPM|2|00076787002||004^蓄尿^JC10|||||||||||||20260910143000
      OBR|1|ord0003|f0003|3C015000000427101^クレアチニン尿^JC10|||20260910143000
      ORC|SC|ord0003|||CM
      OBX|1|SN|3C015000000427101^クレアチニン尿^JC10||<^5|mg/dl|1.0-1.5||||F
    HL7
  end

  it "OUL は SPM が群を開き、同じ検体の OBR が続く間は検体を引き継ぐ" do
    message = parse(oul).parse

    expect(message.message_type).to eq("OUL^R22")
    expect(message.reports.size).to eq(3)
    expect(message.reports.map { |r| r.specimens.flat_map(&:ids) })
      .to eq([["00076787001"], ["00076787001"], ["00076787002"]])
    expect(message.reports.map(&:placer_order_number)).to eq(%w[ord0001 ord0002 ord0003])
    # OBR の後に来る ORC も同じ群に入る(ORU と順序が逆)。
    expect(message.reports.map(&:filler_order_number)).to eq(%w[f0001 f0002 f0003])
  end

  it "SPM 直下の OBX は検体の状態で結果ではないので取り込まない" do
    message = parse(oul).parse
    expect(message.reports.flat_map(&:observations).map(&:code))
      .to eq(%w[3C015000002327201 8A025000009827129 3C015000000427101])
  end

  it "構造化数値(SN)は比較子と値をつなげて読む" do
    message = parse(oul).parse
    expect(message.reports.last.observations.first.value).to eq("<5")
  end

  it "単位は表示名(第 2 成分)を優先する" do
    message = parse(oul).parse
    expect(message.reports[1].observations.first.unit).to eq("L/day")
  end

  it "結果が得られない(X)・削除(D)の OBX は取り込まず数だけ残す" do
    # 削除(D)の行は SPM より前に置く(SPM 直下の OBX は検体の状態なので別扱い)。
    text = oru.sub("|N|F|||20260912091500|LAB", "|N|X")
               .sub("SPM|1|", "OBX|2|NM|3B035000002327201^AST^JC10||50||||||D\r\nSPM|1|")
    parser = parse(text)
    message = parser.parse

    expect(message.reports.first.observations).to be_empty
    expect(parser.skipped_count).to eq(2)
  end

  it "改行が LF でも CR でも CRLF でも読める" do
    %W[\n \r \r\n].each do |eol|
      text = oru.gsub("\r\n", eol)
      expect(parse(text).parse.reports.first.observations.size).to eq(1)
    end
  end

  it "MLLP の枠が付いていても剥がして読む" do
    expect(parse("\x0B#{oru}\x1C\r").parse.reports.size).to eq(1)
  end

  it "バッチのヘッダ・トレーラは読み飛ばす" do
    text = "FHS|^~\\&|LIS\rBHS|^~\\&|LIS\r#{oru}BTS|1\rFTS|1\r"
    expect(parse(text).parse.reports.size).to eq(1)
  end

  it "エスケープを元の文字に戻す" do
    text = oru.sub("総合所見です", "A\\F\\B\\S\\C\\T\\D\\R\\E\\E\\F")
    expect(parse(text).parse.reports.first.comments).to eq(["A|B^C&D~E\\F"])
  end

  it "体系名が無い 17 桁のコードは JLAC10 と JLAC11 の両方の候補にする" do
    text = oru.sub("3D0450000019204^HbA1c^JC10||5.5", "3D045000001920401^HbA1c^||5.5")
    observation = parse(text).parse.reports.first.observations.first
    expect(observation.jlac10).to eq("3D045000001920401")
    expect(observation.jlac11).to eq("3D045000001920401")
  end

  it "1 つの ORC に OBR が複数あれば別の群にする" do
    text = oru + "OBR|2|0523002|f2|3B0350000023272^AST^JC10|||20260910143000\r" \
                 "OBX|1|NM|3B0350000023272^AST^JC10||50|U|6-28|||N|F\r"
    expect(parse(text).parse.reports.size).to eq(2)
  end

  it "MSH が無いファイルは取り込まない" do
    expect { parse("PID|||P0001\r").parse }.to raise_error(LabImport::ImportError, /MSH/)
  end
end
