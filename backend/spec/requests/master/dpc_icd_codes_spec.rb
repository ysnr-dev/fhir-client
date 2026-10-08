require "rails_helper"

RSpec.describe "Master::DpcIcdCodes", type: :request do
  describe "GET /master/dpc_icd_codes" do
    before do
      create_code("010010", "C700", "exact", "C700", "髄膜の悪性新生物＜腫瘍＞，脳髄膜")
      create_code("040040", "C34", "prefix", "C34$", "気管支及び肺の悪性新生物＜腫瘍＞")
      create_code("050130", "I50", "prefix", "I50$", "心不全")
      create_code("060180", "M074", "prefix", "M074$", "クローン病における関節障害")
      create_code("070370", "M8008", "exact", "M8008", "脊椎骨粗鬆症")
      create_code("071030", "M", "fallback", "M!!!!", "その他の筋骨格系及び結合組織の疾患")
    end

    def create_code(mdc6, icd10, match_type, icd_pattern, icd_name)
      Master::DpcIcdCode.create!(
        mdc6: mdc6, icd10: icd10, match_type: match_type, icd_pattern: icd_pattern, icd_name: icd_name
      )
    end

    def body_for(params)
      get "/master/dpc_icd_codes", params: params
      JSON.parse(response.body)
    end

    def mdc6_by_icd(icd10)
      body_for(icd10: icd10)["items"].group_by { |i| i["icd10"] }.transform_values { |v| v.map { |i| i["mdc6"] } }
    end

    it "完全一致のコードを引ける" do
      item = body_for(icd10: "C700")["items"].first

      expect(item).to include("mdc6" => "010010", "icd10" => "C700", "icd_name" => "髄膜の悪性新生物＜腫瘍＞，脳髄膜")
    end

    it "「I50$」のような表記には前方一致で当たり、items の icd10 は問い合わせたコードになる" do
      item = body_for(icd10: "I500")["items"].first

      expect(item).to include("mdc6" => "050130", "icd10" => "I500", "icd_pattern" => "I50$", "icd_name" => "心不全")
    end

    it "カンマ区切りで複数まとめて引ける" do
      expect(mdc6_by_icd("I500,C341,C700")).to eq(
        "I500" => ["050130"], "C341" => ["040040"], "C700" => ["010010"]
      )
    end

    it "3桁・5桁のコードでも引ける" do
      expect(mdc6_by_icd("I50,M0740,M8008")).to eq(
        "I50" => ["050130"], "M0740" => ["060180"], "M8008" => ["070370"]
      )
    end

    it "完全一致の行は、桁が違うコードには当たらない" do
      expect(mdc6_by_icd("C7001,C70")).to eq({})
    end

    it "表に無い M コードは受け皿(M!!!!)の分類に落ちる" do
      expect(mdc6_by_icd("M545,M0740")).to eq("M545" => ["071030"], "M0740" => ["060180"])
    end

    it "小数点付き・小文字でも引ける" do
      expect(mdc6_by_icd("i50.0")).to eq("I500" => ["050130"])
    end

    it "どの行にも当たらないコードは items に出ない" do
      body = body_for(icd10: "Z999")

      expect(body["total"]).to eq(0)
      expect(body["items"]).to eq([])
    end

    it "icd10 指定時は per の上限に関わらず全件返す" do
      codes = (0..149).map { |n| format("I50%02d", n) }

      body = body_for(icd10: codes.join(","))

      expect(body["total"]).to eq(150)
      expect(body["items"].size).to eq(150)
    end

    it "icd10 を指定しなければページ区切りの一覧を返す" do
      body = body_for(per: 2)

      expect(body["total"]).to eq(6)
      expect(body["per"]).to eq(2)
      expect(body["items"].size).to eq(2)
    end

    it "診断群分類上6桁で絞れる" do
      expect(body_for(mdc6: "050130")["items"].map { |i| i["icd_pattern"] }).to eq(["I50$"])
    end
  end

  describe "GET /master/dpc_icd_codes(版)" do
    before do
      Master::DpcEdition.create!(edition: "20240601", imported_at: Time.current)
      Master::DpcEdition.create!(edition: "20260601", imported_at: Time.current)
      Master::DpcIcdCode.create!(edition: "20240601", mdc6: "050130", icd10: "I50", match_type: "prefix",
                                 icd_pattern: "I50$", valid_from: "20240601", valid_to: "99999999")
      Master::DpcIcdCode.create!(edition: "20260601", mdc6: "050131", icd10: "I50", match_type: "prefix",
                                 icd_pattern: "I50$", valid_from: "20260601", valid_to: "99999999")
    end

    def mdc6_on(on)
      get "/master/dpc_icd_codes", params: { icd10: "I500", on: on }.compact
      JSON.parse(response.body)["items"].map { |i| i["mdc6"] }
    end

    it "基準日(on)の版で引く" do
      expect(mdc6_on("2026-05-31")).to eq(["050130"])
      expect(mdc6_on("2026-06-01")).to eq(["050131"])
    end

    it "基準日を省けば今日の版" do
      travel_to Time.zone.parse("2026-10-08 12:00") do
        expect(mdc6_on(nil)).to eq(["050131"])
      end
    end
  end
end
