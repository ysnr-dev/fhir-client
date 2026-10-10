require "rails_helper"

# fixture(nursing_acuity_b1_sample.xlsx / nursing_acuity_b2_sample.xlsx)は厚生労働省の配布ファイル
# (令和8年度 別紙7 別表1・別表2)の先頭シートから数行を抜き出したもの。
RSpec.describe "Master::NursingAcuityCodes", type: :request do
  def import(name)
    post "/master/nursing_acuity_codes/import", params: { file: fixture_file_upload(name) }
  end

  describe "POST /master/nursing_acuity_codes/import" do
    it "別表1 を項目コードに振り分けて取り込む(結合セルの続き・A6 の小項目・C の日数・※)" do
      import("nursing_acuity_b1_sample.xlsx")

      expect(response).to have_http_status(:ok)
      # A3 の規則の行はコードではないので数えない。
      expect(JSON.parse(response.body)).to include("imported" => 10, "skipped" => 0)
      rows = Master::NursingAcuityCode.where(kind: "item").order(:display_order).pluck(:item_code, :code, :form_i_only, :days)
      expect(rows).to eq(
        [
          ["A1", "140000610", false, nil],
          ["A5", "620004744", false, nil],
          ["A5", "622984701", false, nil],
          ["A6-1", "620009152", false, nil],
          ["A6-2", "614220011", false, nil],
          ["A6-2", "614220012", false, nil],
          ["A7", "190171910", false, nil],
          ["C15", "150067010", false, 11],
          ["C18", "310006710", true, 10],
          ["C21", "190126810", false, 4]
        ]
      )
    end

    it "別表2 は A3 の除外薬剤として取り込み、別表1 の行は残す" do
      import("nursing_acuity_b1_sample.xlsx")
      import("nursing_acuity_b2_sample.xlsx")

      expect(JSON.parse(response.body)).to include("imported" => 2)
      expect(Master::NursingAcuityCode.where(kind: "a3_exclusion").pluck(:item_code, :code)).to eq(
        [%w[A3 620000237], %w[A3 620000238]]
      )
      expect(Master::NursingAcuityCode.where(kind: "item").count).to eq(10)
    end

    it "取り込み直すとその種類だけ全件入れ替える" do
      Master::NursingAcuityCode.create!(kind: "item", item_code: "A1", code: "999999999", display_order: 1)
      import("nursing_acuity_b1_sample.xlsx")

      expect(Master::NursingAcuityCode.where(code: "999999999")).to be_empty
    end

    it "表題が違うファイルは取り込まない" do
      import("dpc_stem7_sample.xlsx")

      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::NursingAcuityCode.count).to eq(0)
    end
  end

  describe "GET /master/nursing_acuity_codes" do
    before do
      import("nursing_acuity_b1_sample.xlsx")
      import("nursing_acuity_b2_sample.xlsx")
    end

    it "コード(複数)に当たる行を両方の種類まとめて返す" do
      get "/master/nursing_acuity_codes", params: { code: "140000610,620000237,000000000" }

      items = JSON.parse(response.body)["items"]
      expect(items.map { |i| [i["kind"], i["item_code"], i["code"]] }).to contain_exactly(
        %w[item A1 140000610], %w[a3_exclusion A3 620000237]
      )
    end

    it "コードを渡さなければ種類ごとの件数を返す" do
      get "/master/nursing_acuity_codes"

      expect(JSON.parse(response.body)["counts"]).to eq("item" => 10, "a3_exclusion" => 2)
    end
  end
end
