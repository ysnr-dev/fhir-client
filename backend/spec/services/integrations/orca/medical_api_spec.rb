require "rails_helper"

RSpec.describe Integrations::Orca::MedicalApi do
  let(:date) { "2026-09-20" }
  let(:classes) { [{ "Medical_Class" => "600" }] }

  # 送った電文と返す応答を覚えるだけの日レセ。
  let(:gateway) do
    Class.new do
      attr_reader :calls
      attr_accessor :responses

      def initialize
        @calls = []
        @responses = []
      end

      def post(path, _root, attributes, params: {})
        @calls << { path: path, attributes: attributes, params: params }
        body = @responses.shift || { "Api_Result" => "00", "Medical_Uid" => "uid-#{@calls.length}" }
        Integrations::Orca::Gateway::Result.new(
          api_result: Integrations::Orca::ApiResult.from(body), body: body,
          request_xml: "<xml/>", response_body: "<xml/>"
        )
      end
    end.new
  end

  subject(:api) { described_class.new(gateway) }

  def register
    api.register(classes, patient_id: "00001", perform_date: date,
                          department_code: "01", physician_code: "10001",
                          coverage_set_key: "0001")
  end

  it "registers with class=01 when the day has no data yet" do
    result = register

    expect(gateway.calls.map { |c| c[:params] }).to eq([{ "class" => "01" }])
    expect(result.body["Medical_Uid"]).to eq("uid-1")
    expect(result).to be_ok
  end

  # 日レセは同じ患者・同じ日に 2 度目の登録を受け付けない(80)。外来の送り直しは仕様上
  # 削除しかできないので、Medical_Uid を日レセから引き直して 削除 → 再登録 する。
  it "deletes the existing 中途終了データ and registers again when the day already has data" do
    gateway.responses = [
      { "Api_Result" => "80", "Api_Result_Message" => "既に同日の診療データが登録されています" },
      { "Api_Result" => "00",
        "Tmedical_List_Information" => [
          { "Patient_Information" => { "Patient_ID" => "00001" },
            "Department_Code" => "01", "Medical_Uid" => "existing-uid" }
        ] },
      { "Api_Result" => "00", "Api_Result_Message" => "削除処理終了" },
      { "Api_Result" => "00", "Api_Result_Message" => "登録処理終了", "Medical_Uid" => "new-uid" }
    ]

    result = register

    expect(gateway.calls.map { |c| c[:path] })
      .to eq(%w[/api21/medicalmodv2 /api01rv2/tmedicalgetv2 /api21/medicalmodv2 /api21/medicalmodv2])
    expect(gateway.calls.map { |c| c[:params]["class"] }).to eq(["01", nil, "02", "01"])
    expect(gateway.calls[2][:attributes]["Medical_Uid"]).to eq("existing-uid")
    expect(result).to be_ok
    expect(result.body["Medical_Uid"]).to eq("new-uid")
  end

  # 削除は通ったのに再登録が落ちると、医事側にはもう何も無い。それを言わずに
  # 「失敗」とだけ出すと、前のデータが残っていると思われる。
  it "says that the 医事側 data is gone when the re-registration fails after the delete" do
    gateway.responses = [
      { "Api_Result" => "80" },
      { "Api_Result" => "00",
        "Tmedical_List_Information" => [
          { "Patient_Information" => { "Patient_ID" => "00001" },
            "Department_Code" => "01", "Medical_Uid" => "existing-uid" }
        ] },
      { "Api_Result" => "00" },
      { "Api_Result" => "13", "Api_Result_Message" => "ドクターコードが未設定です" }
    ]

    result = register

    expect(result).not_to be_ok
    expect(result.api_result.message).to include("消えています")
    expect(result.api_result.message).to include("ドクターコード")
  end

  it "does not register again when the delete itself fails" do
    gateway.responses = [
      { "Api_Result" => "80" },
      { "Api_Result" => "00",
        "Tmedical_List_Information" => [
          { "Patient_Information" => { "Patient_ID" => "00001" },
            "Department_Code" => "01", "Medical_Uid" => "existing-uid" }
        ] },
      { "Api_Result" => "31", "Api_Result_Message" => "内容が更新されています" }
    ]

    result = register

    expect(gateway.calls.length).to eq(3)
    expect(result.api_result.code).to eq("31")
  end

  # UID が引けないのに class=03 を送ると「ＵＩＤが未設定です」になるだけなので、
  # 送らずに 80 をそのまま返す。
  it "reports the original error when no existing Medical_Uid can be found" do
    gateway.responses = [
      { "Api_Result" => "80", "Api_Result_Message" => "既に同日の診療データが登録されています" },
      { "Api_Result" => "00", "Tmedical_List_Information" => [] }
    ]

    result = register

    expect(gateway.calls.map { |c| c[:params]["class"] }).to eq(["01", nil])
    expect(result.api_result.code).to eq("80")
    expect(result).not_to be_ok
  end

  # 保険組合せ番号が不正でも日レセはエラーにせず、ゼロで登録して W02 を返す。
  it "fails when the 日レセ registered a different 保険組合せ than the one sent" do
    gateway.responses = [
      { "Api_Result" => "00", "Api_Result_Message" => "登録処理終了",
        "Patient_Information" => { "HealthInsurance_Information" => { "Insurance_Combination_Number" => "0000" } } }
    ]

    result = register

    expect(result).not_to be_ok
    expect(result.api_result.code).to eq("insurance_mismatch")
    expect(result.api_result.message).to include("送信 0001")
  end

  it "accepts the 保険組合せ echoed back with different zero padding" do
    gateway.responses = [
      { "Api_Result" => "00",
        "Patient_Information" => { "HealthInsurance_Information" => { "Insurance_Combination_Number" => "1" } } }
    ]

    expect(register).to be_ok
  end

  it "sends the 診療時刻 so the 日レセ can apply 時間外 加算" do
    api.register(classes, patient_id: "00001", perform_date: date, perform_time: "19:45",
                          department_code: "01", physician_code: "10001", coverage_set_key: "0001")

    expect(gateway.calls.first[:attributes]["Perform_Time"]).to eq("19:45:00")
  end

  it "omits Perform_Time when the chart has no 診察開始時刻" do
    register

    expect(gateway.calls.first[:attributes]).not_to have_key("Perform_Time")
  end

  # 別の診療科のデータを掴んで置換すると、他科の中途終了データを壊す。
  it "ignores an existing 中途終了データ from another 診療科" do
    gateway.responses = [
      { "Api_Result" => "80" },
      { "Api_Result" => "00",
        "Tmedical_List_Information" => [
          { "Patient_Information" => { "Patient_ID" => "00001" },
            "Department_Code" => "02", "Medical_Uid" => "other-department" }
        ] }
    ]

    expect(register).not_to be_ok
  end

  # カルテの患者番号はゼロ埋めなし("2")、日レセは 1009 の連番桁数でゼロ埋めした形
  # ("00002")で返す。そのまま比べると自分が送ったデータを見つけられない。
  it "matches the 中途終了データ although the 日レセ zero-pads the 患者番号" do
    gateway.responses = [
      { "Api_Result" => "00",
        "Tmedical_List_Information" => [
          { "Patient_Information" => { "Patient_ID" => "00002" },
            "Department_Code" => "01", "Medical_Uid" => "padded-uid" }
        ] }
    ]

    uid = api.find_uid(patient_id: "2", perform_date: date, department_code: "01")

    expect(uid).to eq("padded-uid")
  end

  describe "#find_entry" do
    def entry(row)
      gateway.responses = [{ "Api_Result" => "00", "Tmedical_List_Information" => [row.merge(
        "Patient_Information" => { "Patient_ID" => "00001" }, "Department_Code" => "01"
      )] }]
      api.find_entry(patient_id: "00001", perform_date: date, department_code: "01")
    end

    it "is controllable when the data was registered by the API and is not opened" do
      expect(entry("Medical_Uid" => "u")).to be_controllable
    end

    it "is not controllable while the 日レセ has it opened on screen" do
      expect(entry("Medical_Uid" => "u", "Medical_Mode" => "1")).not_to be_controllable
    end

    it "is not controllable when the 日レセ screen re-saved it (the Medical_Uid is gone)" do
      found = entry("Medical_Uid" => "")

      expect(found).not_to be_nil
      expect(found).not_to be_controllable
    end
  end

  it "sends 外来 and lets the 日レセ price the 診察料" do
    register

    attributes = gateway.calls.first[:attributes]
    expect(attributes["InOut"]).to eq("")
    expect(attributes["Medical_Fee_Auto"]).to eq("Yes")
    expect(attributes["Diagnosis_Information"]["Department_Code"]).to eq("01")
    expect(attributes["Diagnosis_Information"]["HealthInsurance_Information"])
      .to eq({ "Insurance_Combination_Number" => "0001" })
  end

  describe "#cancel" do
    it "deletes with class=02 and includes the 診療科 the 日レセ insists on" do
      gateway.responses = [
        { "Api_Result" => "00",
          "Tmedical_List_Information" => [
            { "Patient_Information" => { "Patient_ID" => "00001" },
              "Department_Code" => "01", "Medical_Uid" => "uid-1" }
          ] },
        { "Api_Result" => "00" }
      ]

      result = api.cancel(patient_id: "00001", perform_date: date, department_code: "01")

      expect(gateway.calls.last[:params]).to eq({ "class" => "02" })
      expect(gateway.calls.last[:attributes]["Medical_Uid"]).to eq("uid-1")
      expect(gateway.calls.last[:attributes]["Diagnosis_Information"])
        .to eq({ "Department_Code" => "01" })
      expect(result).to be_ok
    end

    it "does nothing when the 日レセ has no 中途終了データ for the day" do
      gateway.responses = [{ "Api_Result" => "00", "Tmedical_List_Information" => [] }]

      expect(api.cancel(patient_id: "00001", perform_date: date, department_code: "01")).to be_nil
      expect(gateway.calls.length).to eq(1)
    end
  end
end
