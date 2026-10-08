require "rails_helper"

# fixture(dpc_stem7_sample.xlsx)は厚生労働省の配布ファイルから数行を抜き出したもの。
RSpec.describe "Master::DpcStem7Codes", type: :request do
  describe "POST /master/dpc_stem7_codes/import" do
    it "配布ファイルを取り込み、点数表コードを様式1 の書き方に、STEM7 を 7 桁にそろえる" do
      post "/master/dpc_stem7_codes/import", params: { file: fixture_file_upload("dpc_stem7_sample.xlsx") }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to include("imported" => 14, "skipped" => 0)
      expect(Master::DpcStem7Code.pluck(:k_code).uniq).to eq(
        %w[K0001 K0821ｲ K0821ﾛ K1542ｲ K1542ﾛ K426-23 K5612ﾆ K9203ｲ(1) K9204ｲ(1)]
      )
      row = Master::DpcStem7Code.find_by(k_code: "K0821ｲ")
      expect(row).to have_attributes(k_code_source: "K082 1 ｲ", stem7: "B283404", note: nil)
    end

    it "取り込み直すと全件入れ替える" do
      Master::DpcStem7Code.create!(k_code: "K9999", k_code_source: "K999 9", stem7: "A000000", display_order: 1)
      post "/master/dpc_stem7_codes/import", params: { file: fixture_file_upload("dpc_stem7_sample.xlsx") }

      expect(Master::DpcStem7Code.where(k_code: "K9999")).to be_empty
    end

    it "見出しが違うファイルは取り込まない" do
      post "/master/dpc_stem7_codes/import", params: { file: fixture_file_upload("ctcae_terms_sample.xlsx") }

      expect(response).to have_http_status(:unprocessable_content)
      expect(Master::DpcStem7Code.count).to eq(0)
    end
  end

  describe "GET /master/dpc_stem7_codes" do
    before do
      post "/master/dpc_stem7_codes/import", params: { file: fixture_file_upload("dpc_stem7_sample.xlsx") }
    end

    it "点数表コード(複数)から候補を配布ファイルの順に引く。書き方の揺れはそろえて引く" do
      get "/master/dpc_stem7_codes", params: { k_code: "K0001,Ｋ０８２１ｲ", per: 100 }

      items = JSON.parse(response.body)["items"]
      expect(items.map { |i| [i["k_code"], i["stem7"]] }).to eq(
        [%w[K0001 A113000], %w[K0001 T611700], %w[K0001 A233400], %w[K0001 A231700], %w[K0821ｲ B283404]]
      )
      expect(items.second["note"]).to eq("埋め込み型中心静脈カテーテル抜去術の場合")
    end
  end
end
