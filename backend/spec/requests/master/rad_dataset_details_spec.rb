require "rails_helper"

RSpec.describe "Master::RadDatasetDetails", type: :request do
  def body
    JSON.parse(response.body)
  end

  before do
    Master::RadDataset.create!(dataset_code: "000001", name: "造影CT標準セット")
    Master::RadDataset.create!(dataset_code: "000002", name: "穿刺器材セット")
    Master::MedicalProcedure.create!(procedure_code: "170000410", name: "ＣＴ撮影（マルチスライス型）",
                                     points: 1000, abolished_on: "99999999")
    Master::Medicine.create!(medicine_code: "622222901", name: "オムニパーク３００注シリンジ１００ｍＬ",
                             unit_name: "筒")
    Master::RadMaterial.create!(material_code: "000001", name: "延長チューブ", unit_name: "本",
                                receipt_material_code: "710010004")
  end

  describe "GET /master/rad_dataset_details" do
    before do
      Master::RadDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine",
                                       code: "622222901", default_quantity: 100, display_order: 2)
      Master::RadDatasetDetail.create!(dataset_code: "000001", detail_type: "procedure",
                                       code: "170000410", display_order: 1)
      Master::RadDatasetDetail.create!(dataset_code: "000002", detail_type: "material",
                                       code: "000001", default_quantity: 1, display_order: 1)
    end

    it "データセットコードをカンマ区切りで複数指定して一括で引ける" do
      get "/master/rad_dataset_details", params: { dataset_code: "000001,000002" }

      expect(body["items"].size).to eq(3)
      expect(body["items"].map { |i| [i["dataset_code"], i["detail_type"]] }).to eq(
        [%w[000001 procedure], %w[000001 medicine], %w[000002 material]]
      )
    end

    it "3種それぞれの参照先マスタから名称を解決する" do
      get "/master/rad_dataset_details", params: { dataset_code: "000001,000002" }

      resolved = body["items"].to_h { |i| [i["detail_type"], i["resolved_name"]] }
      expect(resolved).to eq(
        "procedure" => "ＣＴ撮影（マルチスライス型）",
        "medicine" => "オムニパーク３００注シリンジ１００ｍＬ",
        "material" => "延長チューブ"
      )
    end

    it "器材には算定用の特定器材コードを添える" do
      get "/master/rad_dataset_details", params: { dataset_code: "000002" }

      expect(body["items"].first["receipt_material_code"]).to eq("710010004")
    end

    it "種別で絞り込める" do
      get "/master/rad_dataset_details", params: { dataset_code: "000001,000002", detail_type: "medicine" }

      expect(body["items"].map { |i| i["code"] }).to eq(%w[622222901])
    end

    it "初期選択かどうかを返す" do
      Master::RadDatasetDetail.create!(dataset_code: "000002", detail_type: "procedure",
                                       code: "170000410", default_selected: false)

      get "/master/rad_dataset_details", params: { dataset_code: "000002" }

      selected = body["items"].to_h { |i| [i["detail_type"], i["default_selected"]] }
      expect(selected).to eq("material" => true, "procedure" => false)
    end

    it "参照先マスタが未取込でも明細は返る(名称は空)" do
      Master::RadDatasetDetail.create!(dataset_code: "000001", detail_type: "procedure", code: "999999999")

      get "/master/rad_dataset_details", params: { dataset_code: "000001", detail_type: "procedure" }

      missing = body["items"].find { |i| i["code"] == "999999999" }
      expect(missing["resolved_name"]).to be_nil
    end
  end

  describe "POST /master/rad_dataset_details" do
    it "表示順を省略すると追加順に採番する" do
      post "/master/rad_dataset_details", params: { dataset_code: "000001", detail_type: "procedure",
                                                    code: "170000410" }
      expect(body["display_order"]).to eq(1)

      post "/master/rad_dataset_details", params: { dataset_code: "000001", detail_type: "medicine",
                                                    code: "622222901", default_quantity: "100" }
      expect(body["display_order"]).to eq(2)
      expect(body["default_quantity"]).to eq("100.0")
    end

    it "初期選択は既定で有効(通常使う明細を積むため)" do
      post "/master/rad_dataset_details", params: { dataset_code: "000001", detail_type: "procedure",
                                                    code: "170000410" }

      expect(body["default_selected"]).to be(true)
    end

    it "使うこともある明細は初期選択を外して登録できる" do
      post "/master/rad_dataset_details", params: { dataset_code: "000001", detail_type: "material",
                                                    code: "000001", default_selected: "false" }

      expect(body["default_selected"]).to be(false)
    end

    it "同じデータセット内で同じ種別・コードは重複登録できない" do
      Master::RadDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine", code: "622222901")

      post "/master/rad_dataset_details", params: { dataset_code: "000001", detail_type: "medicine",
                                                    code: "622222901" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "別のデータセットには同じ明細を登録できる" do
      Master::RadDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine", code: "622222901")

      post "/master/rad_dataset_details", params: { dataset_code: "000002", detail_type: "medicine",
                                                    code: "622222901" }

      expect(response).to have_http_status(:created)
    end

    it "未知の種別は登録できない" do
      post "/master/rad_dataset_details", params: { dataset_code: "000001", detail_type: "device",
                                                    code: "000001" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "数量が0以下なら登録できない" do
      post "/master/rad_dataset_details", params: { dataset_code: "000001", detail_type: "medicine",
                                                    code: "622222901", default_quantity: "0" }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /master/rad_dataset_details/:id" do
    it "既定数量と経路を変更できる" do
      record = Master::RadDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine",
                                                code: "622222901", default_quantity: 100)

      patch "/master/rad_dataset_details/#{record.id}", params: { default_quantity: "50", route_code: "IV" }

      expect(record.reload.default_quantity).to eq(50)
      expect(record.route_code).to eq("IV")
    end

    it "初期選択を切り替えられる" do
      record = Master::RadDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine",
                                                code: "622222901")

      patch "/master/rad_dataset_details/#{record.id}", params: { default_selected: "false" }

      expect(record.reload.default_selected).to be(false)
    end
  end

  describe "DELETE /master/rad_dataset_details/:id" do
    it "削除できる" do
      record = Master::RadDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine",
                                                code: "622222901")

      delete "/master/rad_dataset_details/#{record.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::RadDatasetDetail.count).to eq(0)
    end
  end
end
