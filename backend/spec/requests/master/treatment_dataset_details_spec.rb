require "rails_helper"

RSpec.describe "Master::TreatmentDatasetDetails", type: :request do
  def body
    JSON.parse(response.body)
  end

  before do
    Master::TreatmentDataset.create!(dataset_code: "000001", name: "創傷処置標準セット")
    Master::TreatmentDataset.create!(dataset_code: "000002", name: "気道可逆性試験セット")
    Master::MedicalProcedure.create!(procedure_code: "140002910", name: "創傷処置（１００平方センチメートル未満）",
                                     points: 380, abolished_on: "99999999")
    Master::Medicine.create!(medicine_code: "620000237", name: "生理食塩液　１．３Ｌ", unit_name: "袋")
    Master::MedicalMaterial.create!(material_code: "710010004", name: "延長チューブ", unit_name: "本")
  end

  describe "GET /master/treatment_dataset_details" do
    before do
      Master::TreatmentDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine",
                                          code: "620000237", default_quantity: 1, display_order: 2)
      Master::TreatmentDatasetDetail.create!(dataset_code: "000001", detail_type: "procedure",
                                          code: "140002910", display_order: 1)
      Master::TreatmentDatasetDetail.create!(dataset_code: "000002", detail_type: "material",
                                          code: "710010004", default_quantity: 1, display_order: 1)
    end

    it "データセットコードをカンマ区切りで複数指定して一括で引ける" do
      get "/master/treatment_dataset_details", params: { dataset_code: "000001,000002" }

      expect(body["items"].size).to eq(3)
      expect(body["items"].map { |i| [i["dataset_code"], i["detail_type"]] }).to eq(
        [%w[000001 procedure], %w[000001 medicine], %w[000002 material]]
      )
    end

    it "3種それぞれの参照先マスタから名称を解決する" do
      get "/master/treatment_dataset_details", params: { dataset_code: "000001,000002" }

      resolved = body["items"].to_h { |i| [i["detail_type"], i["resolved_name"]] }
      expect(resolved).to eq(
        "procedure" => "創傷処置（１００平方センチメートル未満）",
        "medicine" => "生理食塩液　１．３Ｌ",
        "material" => "延長チューブ"
      )
    end

    it "器材は特定保険医療材料マスタから直接引く(施設内の器材マスタを挟まない)" do
      get "/master/treatment_dataset_details", params: { dataset_code: "000002" }

      detail = body["items"].first
      # code そのものが算定用の特定器材コードなので、別に算定コードを添えない。
      expect(detail["code"]).to eq("710010004")
      expect(detail["resolved_name"]).to eq("延長チューブ")
      expect(detail["resolved_unit_name"]).to eq("本")
      expect(detail).not_to have_key("receipt_material_code")
    end

    it "種別で絞り込める" do
      get "/master/treatment_dataset_details",
          params: { dataset_code: "000001,000002", detail_type: "medicine" }

      expect(body["items"].map { |i| i["code"] }).to eq(%w[620000237])
    end

    it "初期選択かどうかを返す" do
      Master::TreatmentDatasetDetail.create!(dataset_code: "000002", detail_type: "procedure",
                                          code: "140002910", default_selected: false)

      get "/master/treatment_dataset_details", params: { dataset_code: "000002" }

      selected = body["items"].to_h { |i| [i["detail_type"], i["default_selected"]] }
      expect(selected).to eq("material" => true, "procedure" => false)
    end

    it "参照先マスタが未取込でも明細は返る(名称は空)" do
      Master::TreatmentDatasetDetail.create!(dataset_code: "000001", detail_type: "procedure",
                                          code: "999999999")

      get "/master/treatment_dataset_details", params: { dataset_code: "000001", detail_type: "procedure" }

      missing = body["items"].find { |i| i["code"] == "999999999" }
      expect(missing["resolved_name"]).to be_nil
    end
  end

  describe "POST /master/treatment_dataset_details" do
    it "表示順を省略すると追加順に採番する" do
      post "/master/treatment_dataset_details", params: { dataset_code: "000001", detail_type: "procedure",
                                                       code: "140002910" }
      expect(body["display_order"]).to eq(1)

      post "/master/treatment_dataset_details", params: { dataset_code: "000001", detail_type: "medicine",
                                                       code: "620000237", default_quantity: "1" }
      expect(body["display_order"]).to eq(2)
      expect(body["default_quantity"]).to eq("1.0")
    end

    it "初期選択は既定で有効(通常使う明細を積むため)" do
      post "/master/treatment_dataset_details", params: { dataset_code: "000001", detail_type: "procedure",
                                                       code: "140002910" }

      expect(body["default_selected"]).to be(true)
    end

    it "使うこともある明細は初期選択を外して登録できる" do
      post "/master/treatment_dataset_details", params: { dataset_code: "000001", detail_type: "material",
                                                       code: "710010004", default_selected: "false" }

      expect(body["default_selected"]).to be(false)
    end

    it "同じデータセット内で同じ種別・コードは重複登録できない" do
      Master::TreatmentDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine",
                                          code: "620000237")

      post "/master/treatment_dataset_details", params: { dataset_code: "000001", detail_type: "medicine",
                                                       code: "620000237" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "別のデータセットには同じ明細を登録できる" do
      Master::TreatmentDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine",
                                          code: "620000237")

      post "/master/treatment_dataset_details", params: { dataset_code: "000002", detail_type: "medicine",
                                                       code: "620000237" }

      expect(response).to have_http_status(:created)
    end

    it "未知の種別は登録できない" do
      post "/master/treatment_dataset_details", params: { dataset_code: "000001", detail_type: "device",
                                                       code: "710010004" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "数量が0以下なら登録できない" do
      post "/master/treatment_dataset_details", params: { dataset_code: "000001", detail_type: "medicine",
                                                       code: "620000237", default_quantity: "0" }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /master/treatment_dataset_details/:id" do
    it "既定数量と経路を変更できる" do
      record = Master::TreatmentDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine",
                                                   code: "620000237", default_quantity: 2)

      patch "/master/treatment_dataset_details/#{record.id}", params: { default_quantity: "1",
                                                                     route_code: "IV" }

      expect(record.reload.default_quantity).to eq(1)
      expect(record.route_code).to eq("IV")
    end

    it "初期選択を切り替えられる" do
      record = Master::TreatmentDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine",
                                                   code: "620000237")

      patch "/master/treatment_dataset_details/#{record.id}", params: { default_selected: "false" }

      expect(record.reload.default_selected).to be(false)
    end
  end

  describe "DELETE /master/treatment_dataset_details/:id" do
    it "削除できる" do
      record = Master::TreatmentDatasetDetail.create!(dataset_code: "000001", detail_type: "medicine",
                                                   code: "620000237")

      delete "/master/treatment_dataset_details/#{record.id}"

      expect(response).to have_http_status(:no_content)
      expect(Master::TreatmentDatasetDetail.count).to eq(0)
    end
  end
end
