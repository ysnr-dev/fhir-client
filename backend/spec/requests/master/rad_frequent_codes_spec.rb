require "rails_helper"

RSpec.describe "Master::RadFrequentCodes", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/rad_frequent_codes" do
    let!(:chest) do
      Master::RadJj1017FrequentCode.create!(
        category: "rad_exam", jj1017_code: "10000002000101000000010000000000",
        name: "Ｘ線単純撮影胸部立位正面(指定無し)", display_order: 1
      )
    end
    let!(:head_ct) do
      Master::RadJj1017FrequentCode.create!(
        category: "rad_exam", jj1017_code: "60000001000002000000010000000000",
        name: "Ｘ線ＣＴ撮影頭部", display_order: 2
      )
    end
    let!(:abdomen_us) do
      Master::RadJj1017FrequentCode.create!(
        category: "ultrasound", jj1017_code: "99A00002500000000000000000000000",
        name: "腹部超音波断層撮影法（胸腹部）", display_order: 3
      )
    end

    it "区分で絞り込み、掲載順で返す" do
      get "/master/rad_frequent_codes", params: { category: "rad_exam" }
      expect(body["items"].map { |i| i["jj1017_code"] }).to eq([chest.jj1017_code, head_ct.jj1017_code])
    end

    it "32桁コードの先頭1桁(種別)で絞り込める" do
      get "/master/rad_frequent_codes", params: { modality_code: "6" }
      expect(body["items"].map { |i| i["jj1017_code"] }).to eq([head_ct.jj1017_code])
    end

    it "32桁コードの部位で絞り込める" do
      get "/master/rad_frequent_codes", params: { body_part_code: "200" }
      expect(body["items"].map { |i| i["jj1017_code"] }).to eq([chest.jj1017_code])
    end

    it "名称で検索できる" do
      get "/master/rad_frequent_codes", params: { name: "腹部" }
      expect(body["items"].map { |i| i["jj1017_code"] }).to eq([abdomen_us.jj1017_code])
    end

    it "unregistered=true は未登録のコードだけ返す" do
      Master::RadItem.create!(item_code: "R0001", name: "胸部単純Ｘ線正面",
                              modality_code: "1", body_part_code: "200",
                              body_position_code: "1", direction_code: "01", nuclide_code: "01")

      get "/master/rad_frequent_codes", params: { unregistered: "true" }

      expect(body["items"].map { |i| i["jj1017_code"] })
        .to match_array([head_ct.jj1017_code, abdomen_us.jj1017_code])
    end
  end

  describe "POST /master/rad_frequent_codes/import" do
    it "別表F を取り込んで件数を返す" do
      file = Rack::Test::UploadedFile.new(
        Rails.root.join("spec/fixtures/files/rad_frequent_codes_sample.xls"),
        "application/vnd.ms-excel"
      )

      post "/master/rad_frequent_codes/import", params: { file: file }

      expect(body["imported"]).to eq(3)
      expect(body["skipped"]).to eq(2)
      expect(body["categories"]).to eq("rad_exam" => 2, "ultrasound" => 1)
    end
  end
end
