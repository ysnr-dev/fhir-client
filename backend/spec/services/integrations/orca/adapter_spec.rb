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

    # 電文が空になるなら日レセを叩かない。空の Medical_Information はエラーになる。
    it "refuses to send when nothing maps, without calling the レセコン" do
      result = adapter.send_billing(claim([item(:nursing)]))

      expect(result.outcome).to eq(:failed)
      expect(result.code).to eq("no_items")
      expect(WebMock).not_to have_requested(:post, %r{orca\.example})
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
