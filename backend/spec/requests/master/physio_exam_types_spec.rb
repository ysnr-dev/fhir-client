require "rails_helper"

RSpec.describe "Master::PhysioExamTypes", type: :request do
  def body
    JSON.parse(response.body)
  end

  describe "GET /master/physio_exam_types" do
    before do
      Master::PhysioExamType.create!(exam_type_code: "01", name: "心電図", short_name: "ECG",
                                     name_kana: "シンデンズ", display_order: 1)
      Master::PhysioExamType.create!(exam_type_code: "02", name: "超音波検査", short_name: "US",
                                     display_order: 2)
      Master::PhysioExamType.create!(exam_type_code: "03", name: "廃止した種別", display_order: 3,
                                     valid_from: Date.current - 100, valid_to: Date.current - 1)
    end

    it "表示順で一覧を返す" do
      get "/master/physio_exam_types"

      expect(body["items"].map { |i| i["exam_type_code"] }).to eq(%w[01 02 03])
    end

    it "active=true は有効期間内の種別だけ返す" do
      get "/master/physio_exam_types", params: { active: "true" }

      expect(body["items"].map { |i| i["exam_type_code"] }).to eq(%w[01 02])
    end

    it "種別コードをカンマ区切りで複数指定できる" do
      get "/master/physio_exam_types", params: { exam_type_code: "01,03" }

      expect(body["items"].map { |i| i["exam_type_code"] }).to eq(%w[01 03])
    end

    it "名称・略称・カナで検索できる" do
      get "/master/physio_exam_types", params: { name: "しんでんず" }
      expect(body["items"].map { |i| i["exam_type_code"] }).to eq(%w[01])

      get "/master/physio_exam_types", params: { name: "us" }
      expect(body["items"].map { |i| i["exam_type_code"] }).to eq(%w[02])
    end
  end

  describe "GET /master/physio_exam_types/:id" do
    it "種別コードでも id でも引ける" do
      record = Master::PhysioExamType.create!(exam_type_code: "01", name: "心電図")

      get "/master/physio_exam_types/01"
      expect(body["name"]).to eq("心電図")

      get "/master/physio_exam_types/#{record.id}"
      expect(body["exam_type_code"]).to eq("01")
    end
  end

  describe "POST /master/physio_exam_types" do
    it "種別コードを省略すると2桁で自動採番する" do
      Master::PhysioExamType.create!(exam_type_code: "07", name: "既存")

      post "/master/physio_exam_types", params: { name: "血圧脈波検査" }

      expect(response).to have_http_status(:created)
      expect(body["exam_type_code"]).to eq("08")
    end

    it "名称は必須" do
      post "/master/physio_exam_types", params: { note: "名称なし" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "同じ種別コードは登録できない" do
      Master::PhysioExamType.create!(exam_type_code: "01", name: "心電図")

      post "/master/physio_exam_types", params: { exam_type_code: "01", name: "別の種別" }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "有効終了日が有効開始日より前なら登録できない" do
      post "/master/physio_exam_types", params: { name: "期間おかしい",
                                                  valid_from: "2026-08-01", valid_to: "2026-07-01" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("有効開始日以降")
    end
  end

  describe "DELETE /master/physio_exam_types/:id" do
    it "使っている検査項目は消さず、未分類に戻す" do
      Master::PhysioExamType.create!(exam_type_code: "01", name: "心電図")
      item = Master::PhysioItem.create!(item_code: "P0001", name: "心電図12誘導", exam_type_code: "01")
      other = Master::PhysioItem.create!(item_code: "P0002", name: "腹部超音波", exam_type_code: "02")

      delete "/master/physio_exam_types/01"

      expect(response).to have_http_status(:no_content)
      expect(Master::PhysioExamType.count).to eq(0)
      expect(item.reload.exam_type_code).to be_nil
      # 別の種別を指している項目は触らない。
      expect(other.reload.exam_type_code).to eq("02")
    end
  end
end
