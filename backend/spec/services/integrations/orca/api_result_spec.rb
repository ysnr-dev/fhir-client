require "rails_helper"

RSpec.describe Integrations::Orca::ApiResult do
  describe "success" do
    # Api_Result の桁数は API ごとに違う(system01lstv2 は 2 桁、incomeinfv2 と
    # manageusersv2 は 4 桁、diseasev2 は 3 桁)。"00" 固定で比べると 4 桁系を
    # 全部失敗扱いにしてしまう。
    it "treats any all-zero code as success regardless of width" do
      %w[00 000 0000].each do |code|
        expect(described_class.new(code: code, message: "")).to be_ok
      end
    end

    it "treats anything else as failure" do
      %w[01 P1 E20 80 0001 90].each do |code|
        expect(described_class.new(code: code, message: "")).not_to be_ok
      end
    end

    it "is not ok when the code is missing" do
      expect(described_class.new(code: nil, message: "")).not_to be_ok
      expect(described_class.new(code: "", message: "")).not_to be_ok
    end
  end

  describe ".from" do
    it "reads the nested Medical/Disease results that medicalmodv2 returns" do
      result = described_class.from({
        "Api_Result" => "00",
        "Disease_Message_Information" => {
          "Disease_Result" => "01",
          "Disease_Result_Message" => "登録出来ない病名が存在します",
          "Disease_Warning_Info" => [
            {
              "Disease_Warning" => "E03",
              "Disease_Warning_Message" => "病名コードが不正です",
              "Disease_Warning_Item_Position" => "02",
              "Disease_Warning_Code" => "8830052"
            }
          ]
        }
      })

      # Api_Result が 00 でも部分的に失敗している。成功とは区別する。
      expect(result).to be_ok
      expect(result).to be_warning
      expect(result.status).to eq("warning")
      expect(result.warnings.map { |w| w["code"] }).to eq(%w[01 E03])
      expect(result.warnings.last).to include("position" => "02", "target_code" => "8830052")
    end

    it "reads warnings that sit directly under the response" do
      result = described_class.from({
        "Api_Result" => "00",
        "Medical_Warning_Info" => [
          { "Medical_Warning" => "W04", "Medical_Warning_Message" => "入院期間中です。" }
        ]
      })

      expect(result.warnings.map { |w| w["code"] }).to eq(%w[W04])
      # 位置に関係しない警告では ORCA が位置を省くので、キーごと落とす。
      expect(result.warnings.first).not_to have_key("position")
    end

    it "is plain success when nothing went wrong" do
      result = described_class.from({ "Api_Result" => "00", "Api_Result_Message" => "登録処理終了" })

      expect(result.status).to eq("succeeded")
      expect(result.warnings).to be_empty
    end

    it "is failed when Api_Result itself is an error" do
      result = described_class.from({ "Api_Result" => "80", "Api_Result_Message" => "既に同日の診療データが登録されています" })

      expect(result.status).to eq("failed")
      expect(result).not_to be_warning
    end
  end

  describe "#busy?" do
    # 他端末使用中だけは待てば直るので、Gateway が再送の判断に使う。
    it "is true only for 90" do
      expect(described_class.new(code: "90", message: "")).to be_busy
      expect(described_class.new(code: "80", message: "")).not_to be_busy
    end
  end

  # acceptmodv2 は「登録したが言っておきたいことがある」を K 系で返す。
  # ゼロでないからと失敗にすると、日レセに受付が入っているのに画面が失敗と言う。
  describe "accepted_codes" do
    it "treats a declared non-zero code as accepted with a warning" do
      result = described_class.from(
        { "Api_Result" => "K3", "Api_Result_Message" => "受付登録終了" },
        accepted_codes: %w[K3]
      )

      expect(result).to be_ok
      expect(result.status).to eq("warning")
    end

    it "still fails for codes that were not declared" do
      result = described_class.from({ "Api_Result" => "K9" }, accepted_codes: %w[K3])

      expect(result).not_to be_ok
      expect(result.status).to eq("failed")
    end
  end

  # 層ごとの警告とは別の入れ物。これを読まないと理由が画面に出ない。
  describe "Api_Warning_Message_Information" do
    it "collects the API-level notices" do
      result = described_class.from({
        "Api_Result" => "K3",
        "Api_Warning_Message_Information" => [
          { "Api_Warning_Message" => "診療内容情報を自動設定しました" }
        ]
      }, accepted_codes: %w[K3])

      expect(result.warnings.map { |w| w["message"] }).to eq(["診療内容情報を自動設定しました"])
    end
  end
end
