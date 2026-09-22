require "rails_helper"

RSpec.describe Integrations::Orca::Adapter do

  let(:config) do
    ExternalSystemConnection::EffectiveConfig.new(
      system_key: "receipt_computer", system_type: "orca", enabled: true,
      base_url: "http://orca.example:8000", username: "ormaster", password: "secret",
      options: { "api_prefix" => "/api" }
    )
  end

  subject(:adapter) { described_class.new(config) }

  def stub_post(body)
    stub_request(:post, %r{http://orca\.example:8000/api/.*})
      .to_return(status: 200, body: body, headers: { "Content-Type" => "application/xml" })
  end

  def xml(**fields)
    inner = fields.map { |k, v| %(<#{k} type="string">#{v}</#{k}>) }.join
    %(<xmlio2><res type="record">#{inner}</res></xmlio2>)
  end

  def stub_path(path, body)
    stub_request(:post, %r{http://orca\.example:8000/api#{Regexp.escape(path)}})
      .to_return(status: 200, body: body, headers: { "Content-Type" => "application/xml" })
  end

  # 中途終了データ一覧(tmedicalgetv2)の 1 行。
  def tmedical_xml(uid:, mode: "", mode2: "")
    %(<xmlio2><res type="record"><Api_Result type="string">00</Api_Result>
      <Tmedical_List_Information type="array"><Tmedical_List_Information_child type="record">
        <Patient_Information type="record"><Patient_ID type="string">00001</Patient_ID></Patient_Information>
        <Department_Code type="string">01</Department_Code>
        <Medical_Uid type="string">#{uid}</Medical_Uid>
        <Medical_Mode type="string">#{mode}</Medical_Mode>
        <Medical_Mode2 type="string">#{mode2}</Medical_Mode2>
      </Tmedical_List_Information_child></Tmedical_List_Information></res></xmlio2>)
  end

  # 受付一覧(acceptlstv2)。会計済みの患者を並べる。
  def acceptlst_xml(*patient_ids)
    rows = patient_ids.map do |id|
      %(<Acceptlst_Information_child type="record"><Patient_ID type="string">#{id}</Patient_ID>
        <Department_Code type="string">01</Department_Code></Acceptlst_Information_child>)
    end.join
    %(<xmlio2><res type="record"><Api_Result type="string">00</Api_Result>
      <Acceptlst_Information type="array">#{rows}</Acceptlst_Information></res></xmlio2>)
  end

  def claim(items)
    Integrations::ReceiptComputer::Records::BillingClaim.new(patient_number: "00001", date: "2026-09-20", department_code: "01",
                     physician_code: "10001", coverage_set_key: "0001", items: items)
  end

  def item(category)
    Integrations::ReceiptComputer::Records::BillingItem.new(category: category, name: "検査",
                    lines: [Integrations::ReceiptComputer::Records::BillingLine.new(code: "160008010", name: "末梢血液一般", quantity: "1")])
  end

  describe "#send_billing" do
    it "reports success as a neutral result" do
      stub_post(xml(Api_Result: "00", Api_Result_Message: "処理終了"))

      result = adapter.send_billing(claim([item(:lab)]))

      expect(result.outcome).to eq(:succeeded)
      expect(result.code).to eq("00")
    end

    # レセコンが受理していても、送れなかった項目があれば「そのまま成功」とは言わない。
    it "falls back to a warning when a 剤 could not be mapped" do
      stub_post(xml(Api_Result: "00"))

      result = adapter.send_billing(claim([item(:lab), item(:nursing)]))

      expect(result.outcome).to eq(:warning)
      expect(result.skipped.first[:reason]).to include("診療種別区分")
    end

    # 日レセが黙って落とした明細(M01)は「送れなかった項目」として並べ、成功とは言わない。
    it "lists lines the 日レセ dropped (M01) next to the ones the chart could not send" do
      stub_post(%(<xmlio2><res type="record"><Api_Result type="string">00</Api_Result>
        <Medical_Message_Information type="record"><Medical_Warning_Info type="array">
          <Medical_Warning_Info_child type="record">
            <Medical_Warning type="string">M01</Medical_Warning>
            <Medical_Warning_Message type="string">点数マスタに登録がありません。</Medical_Warning_Message>
            <Medical_Warning_Item_Position type="string">01</Medical_Warning_Item_Position>
            <Medical_Warning_Code type="string">160008010</Medical_Warning_Code>
          </Medical_Warning_Info_child></Medical_Warning_Info></Medical_Message_Information></res></xmlio2>))

      result = adapter.send_billing(claim([item(:lab)]))

      expect(result.outcome).to eq(:warning)
      expect(result.warnings).to be_empty
      expect(result.skipped.first).to include(kind: "医事会計", name: "160008010")
      expect(result.skipped.first[:reason]).to include("取り込まれませんでした")
    end

    # 保険組合せがゼロで登録された(W02)のは登録済みでも失敗として扱う。
    it "fails on W02 and puts the warning text first" do
      stub_post(%(<xmlio2><res type="record"><Api_Result type="string">00</Api_Result>
        <Api_Result_Message type="string">登録処理終了</Api_Result_Message>
        <Medical_Message_Information type="record"><Medical_Warning_Info type="array">
          <Medical_Warning_Info_child type="record">
            <Medical_Warning type="string">W02</Medical_Warning>
            <Medical_Warning_Message type="string">保険組合せをゼロで登録しました</Medical_Warning_Message>
          </Medical_Warning_Info_child></Medical_Warning_Info></Medical_Message_Information></res></xmlio2>))

      result = adapter.send_billing(claim([item(:lab)]))

      expect(result.outcome).to eq(:failed)
      expect(result.message).to start_with("保険組合せをゼロで登録しました")
    end

    # 電文が空になるなら日レセを叩かない。空の Medical_Information はエラーになる。
    it "refuses to send when nothing maps, without calling the レセコン" do
      result = adapter.send_billing(claim([item(:nursing)]))

      expect(result.outcome).to eq(:failed)
      expect(result.code).to eq("no_items")
      expect(WebMock).not_to have_requested(:post, %r{orca\.example})
    end
  end

  describe "#billing_status" do
    def status = adapter.billing_status(patient_number: "00001", date: "2026-09-20", department_code: "01")

    it "is :none when the 日レセ has nothing for the day" do
      stub_path("/api01rv2/acceptlstv2", acceptlst_xml)
      stub_path("/api01rv2/tmedicalgetv2", xml(Api_Result: "00"))

      expect(status.state).to eq(:none)
      expect(status).not_to be_locked
    end

    it "is :sent when the chart's data is there untouched" do
      stub_path("/api01rv2/acceptlstv2", acceptlst_xml)
      stub_path("/api01rv2/tmedicalgetv2", tmedical_xml(uid: "uid-1"))

      expect(status.state).to eq(:sent)
      expect(status.detail).to eq("uid-1")
      expect(status).to be_sent
    end

    it "is :opened while the 医事課 has it open on the 日レセ screen" do
      stub_path("/api01rv2/acceptlstv2", acceptlst_xml)
      stub_path("/api01rv2/tmedicalgetv2", tmedical_xml(uid: "uid-1", mode: "1"))

      expect(status.state).to eq(:opened)
      expect(status.message).to include("展開")
      expect(status).to be_locked
    end

    it "is :opened when the 日レセ screen re-saved it and the Medical_Uid is gone" do
      stub_path("/api01rv2/acceptlstv2", acceptlst_xml)
      stub_path("/api01rv2/tmedicalgetv2", tmedical_xml(uid: ""))

      expect(status.state).to eq(:opened)
    end

    it "is :settled once the 会計 is done, without asking for 中途終了データ" do
      stub_path("/api01rv2/acceptlstv2", acceptlst_xml("00001"))

      expect(status.state).to eq(:settled)
      expect(status.message).to include("会計済み")
      expect(WebMock).not_to have_requested(:post, %r{tmedicalgetv2})
    end

    it "ignores other patients in the 会計済み list" do
      stub_path("/api01rv2/acceptlstv2", acceptlst_xml("00002"))
      stub_path("/api01rv2/tmedicalgetv2", xml(Api_Result: "00"))

      expect(status.state).to eq(:none)
    end
  end

  describe "例外の読み替え" do
    it "turns a connection failure into Unreachable" do
      stub_request(:post, %r{orca\.example}).to_timeout

      expect { adapter.send_billing(claim([item(:lab)])) }
        .to raise_error(Integrations::ReceiptComputer::Unreachable)
    end

    it "turns a non-XML reply into Rejected" do
      stub_request(:post, %r{orca\.example}).to_return(status: 200, body: "<html>login</html>")

      expect { adapter.send_billing(claim([item(:lab)])) }
        .to raise_error(Integrations::ReceiptComputer::Rejected)
    end
  end

  describe "#send_diagnoses" do
    it "names the 病名 and the reason when the 日レセ rejects one" do
      stub_post(%(<xmlio2><res type="record"><Api_Result type="string">E42</Api_Result>
        <Api_Result_Message type="string">登録出来ない病名が存在します。</Api_Result_Message>
        <Disease_Message_Information type="array"><Disease_Message_Information_child type="record">
          <Disease_Result type="string">E31</Disease_Result>
          <Disease_Result_Message type="string">同名の病名が存在します</Disease_Result_Message>
          <Disease_Warning_Info type="record"><Disease_Warning_Name type="string">感冒</Disease_Warning_Name></Disease_Warning_Info>
        </Disease_Message_Information_child></Disease_Message_Information></res></xmlio2>))
      diagnosis = Integrations::ReceiptComputer::Records::Diagnosis.new(name: "感冒", codes: %w[4609008], modifier_codes: {},
                                                                        start_date: "2026-09-04")

      result = adapter.send_diagnoses(patient_number: "00001", date: "2026-09-20", department_code: "01",
                                      coverage_set_key: "0001", diagnoses: [diagnosis])

      expect(result.outcome).to eq(:failed)
      expect(result.message).to eq("登録出来ない病名が存在します。 感冒: 同名の病名が存在します")
    end

    # E40 は「廃止・移行先のある病名が混ざっている」。登録はされるので警告扱い。
    it "treats E40 as a warning rather than a failure" do
      stub_post(xml(Api_Result: "E40", Api_Result_Message: "廃止病名があります"))

      diagnosis = Integrations::ReceiptComputer::Records::Diagnosis.new(name: "感冒", codes: %w[4609008], modifier_codes: {})
      result = adapter.send_diagnoses(patient_number: "00001", date: "2026-09-20",
                                      department_code: "01", coverage_set_key: "0001",
                                      diagnoses: [diagnosis])

      expect(result.outcome).to eq(:warning)
    end

    it "does not call the レセコン when no 病名 has a code" do
      diagnosis = Integrations::ReceiptComputer::Records::Diagnosis.new(name: "手書き病名", codes: [], modifier_codes: {})

      result = adapter.send_diagnoses(patient_number: "00001", date: "2026-09-20",
                                      department_code: "01", coverage_set_key: nil,
                                      diagnoses: [diagnosis])

      expect(result).to be_nil
      expect(WebMock).not_to have_requested(:post, %r{orca\.example})
    end
  end

  describe "#fetch_patient" do
    # 保険組合せが無い患者。ここで見たいのは患者基本情報だけ。
    def stub_patient(home_address)
      stub_request(:get, %r{http://orca\.example:8000/api/api01rv2/patientgetv2})
        .to_return(status: 200, headers: { "Content-Type" => "application/xml" }, body: <<~XML)
          <xmlio2><patientinfores type="record">
            <Api_Result type="string">00</Api_Result>
            <Patient_Information type="record">
              <Patient_ID type="string">00021</Patient_ID>
              <WholeName type="string">連携　花子</WholeName>
              <WholeName_inKana type="string">レンケイ　ハナコ</WholeName_inKana>
              <BirthDate type="string">1985-03-03</BirthDate>
              <Sex type="string">2</Sex>
              #{home_address}
            </Patient_Information>
          </patientinfores></xmlio2>
        XML
      stub_request(:post, %r{http://orca\.example:8000/api/api01rv2/patientlst6v2})
        .to_return(status: 200, headers: { "Content-Type" => "application/xml" },
                   body: xml(Api_Result: "E20", Api_Result_Message: "対象となる保険組合せが存在しません"))
    end

    # 日レセは項目定義では record の PhoneNumber1 を、実際には文字列で返す。
    it "reads a phone number that comes back as a plain string" do
      stub_patient(<<~XML)
        <Home_Address_Information type="record">
          <Address_ZipCode type="string">1130033</Address_ZipCode>
          <WholeAddress1 type="string">東京都文京区本郷</WholeAddress1>
          <WholeAddress2 type="string">１−２−３</WholeAddress2>
          <PhoneNumber1 type="string">03-1234-5678</PhoneNumber1>
        </Home_Address_Information>
      XML

      patient = adapter.fetch_patient("00021").patient

      expect(patient.family).to eq("連携")
      expect(patient.given).to eq("花子")
      expect(patient.address).to eq("東京都文京区本郷１−２−３")
      expect(patient.phone).to eq("03-1234-5678")
    end

    it "reads a phone number nested under Number" do
      stub_patient(<<~XML)
        <Home_Address_Information type="record">
          <PhoneNumber1 type="record"><Number type="string">03-9999-0000</Number></PhoneNumber1>
        </Home_Address_Information>
      XML

      expect(adapter.fetch_patient("00021").patient.phone).to eq("03-9999-0000")
    end

    it "leaves the phone empty when the patient has no address block" do
      stub_patient("")

      expect(adapter.fetch_patient("00021").patient.phone).to be_nil
    end
  end
end
