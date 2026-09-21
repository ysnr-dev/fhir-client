require "rails_helper"

RSpec.describe "Master radiotherapy masters", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/radiotherapy_techniques" do
    before do
      Master::RadiotherapyTechnique.create!(code: "vmat", name: "強度変調回転照射", modality_codes: %w[photon],
                                            display_order: 20)
      Master::RadiotherapyTechnique.create!(code: "2d", name: "2次元照射", display_order: 10)
      Master::RadiotherapyTechnique.create!(code: "old", name: "旧技法", enabled: false, display_order: 30)
    end

    it "表示順で返す" do
      get "/master/radiotherapy_techniques"
      expect(body["items"].map { |i| i["code"] }).to eq(%w[2d vmat old])
    end

    it "enabled=true は有効な行だけ返す" do
      get "/master/radiotherapy_techniques", params: { enabled: "true" }
      expect(body["items"].map { |i| i["code"] }).to eq(%w[2d vmat])
    end

    it "コードのカンマ区切りで一括取得できる" do
      get "/master/radiotherapy_techniques", params: { code: "vmat,old" }
      expect(body["items"].map { |i| i["code"] }).to match_array(%w[vmat old])
    end
  end

  describe "POST /master/radiotherapy_techniques" do
    it "モダリティのコードの配列を保存する" do
      post "/master/radiotherapy_techniques",
           params: { code: "imrt", name: "強度変調放射線治療", modality_codes: %w[photon] }, as: :json

      expect(response).to have_http_status(:created)
      expect(body["modality_codes"]).to eq(%w[photon])
    end

    it "コードの重複を弾く" do
      Master::RadiotherapyTechnique.create!(code: "imrt", name: "IMRT")
      post "/master/radiotherapy_techniques", params: { code: "imrt", name: "別名" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "/master/radiotherapy_modalities" do
    it "コードで引いて更新できる" do
      Master::RadiotherapyModality.create!(code: "photon", name: "X線")

      patch "/master/radiotherapy_modalities/photon", params: { enabled: false }, as: :json

      expect(response).to have_http_status(:ok)
      expect(Master::RadiotherapyModality.find_by(code: "photon").enabled).to be(false)
    end
  end

  describe "/master/radiotherapy_devices" do
    it "装置種別が不正なら弾く" do
      post "/master/radiotherapy_devices", params: { code: "LINAC-01", name: "リニアック1", device_type: "x" },
                                           as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "登録して削除できる" do
      post "/master/radiotherapy_devices",
           params: { code: "LINAC-01", name: "リニアック1", device_type: "linac", modality_codes: %w[photon electron] },
           as: :json
      expect(response).to have_http_status(:created)

      delete "/master/radiotherapy_devices/LINAC-01"
      expect(response).to have_http_status(:no_content)
    end
  end

  describe "GET /master/radiotherapy_stop_reasons" do
    it "kind=terminate は中止に出す理由(both を含む)だけ返す" do
      Master::RadiotherapyStopReason.create!(code: "machine", name: "装置の故障", kind: "suspend", display_order: 10)
      Master::RadiotherapyStopReason.create!(code: "plan", name: "方針変更", kind: "terminate", display_order: 20)
      Master::RadiotherapyStopReason.create!(code: "other", name: "その他", kind: "both", display_order: 30)

      get "/master/radiotherapy_stop_reasons", params: { kind: "terminate" }

      expect(body["items"].map { |i| i["code"] }).to eq(%w[plan other])
    end
  end

  describe "/master/radiotherapy_protocols" do
    let(:payload) do
      {
        code: "RT-TEST", name: "乳房温存術後 50Gy/25回", name_kana: "ニュウボウ", intent: "adjuvant",
        volumes: [{ key: "v1", label: "PTV 全乳房", volume_type: "PTV", body_part_code: "781", body_part_name: "乳房" }],
        phases: [{ label: "全乳房", modality_code: "photon", technique_code: "3d-crt", fractions: 25,
                   fractions_per_week: 5, doses: [{ volume_key: "v1", fraction_dose: 2.0 }] }]
      }
    end

    it "標的と Phase を入れ子のまま保存する" do
      post "/master/radiotherapy_protocols", params: payload, as: :json

      expect(response).to have_http_status(:created)
      expect(body["volumes"].first["body_part_code"]).to eq("781")
      expect(body["phases"].first["doses"]).to eq([{ "volume_key" => "v1", "fraction_dose" => 2.0 }])
    end

    it "線量が標的を指していなければ弾く" do
      broken = payload.deep_dup
      broken[:phases][0][:doses][0][:volume_key] = "v9"
      post "/master/radiotherapy_protocols", params: broken, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "分割回数が無ければ弾く" do
      broken = payload.deep_dup
      broken[:phases][0].delete(:fractions)
      post "/master/radiotherapy_protocols", params: broken, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "名称・カナで検索できる" do
      post "/master/radiotherapy_protocols", params: payload, as: :json

      get "/master/radiotherapy_protocols", params: { name: "にゅうぼう" }
      expect(body["items"].map { |i| i["code"] }).to eq(%w[RT-TEST])
    end
  end
end
