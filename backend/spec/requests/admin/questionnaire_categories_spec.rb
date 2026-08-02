require "rails_helper"

RSpec.describe "Admin::QuestionnaireCategories", type: :request do
  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  describe "CRUD (no ADMIN_TOKEN configured)" do
    it "lists categories in display order" do
      QuestionnaireCategory.create!(name: "検査", display_order: 2)
      QuestionnaireCategory.create!(name: "初診", display_order: 1)

      get "/admin/questionnaire_categories"

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["total"]).to eq(2)
      expect(body["items"].map { |i| i["name"] }).to eq(%w[初診 検査])
      expect(body["items"].first["code"]).to be_present
    end

    it "creates a category and appends it to the end" do
      QuestionnaireCategory.create!(name: "初診", display_order: 5)

      post "/admin/questionnaire_categories", params: { name: "再診" }, as: :json

      expect(response).to have_http_status(:created)
      expect(response.parsed_body["display_order"]).to eq(6)
    end

    it "rejects a blank name" do
      post "/admin/questionnaire_categories", params: { name: "" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to be_present
    end

    it "rejects a duplicate name" do
      QuestionnaireCategory.create!(name: "初診")

      post "/admin/questionnaire_categories", params: { name: "初診" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "renames a category without changing its code" do
      category = QuestionnaireCategory.create!(name: "初診")

      patch "/admin/questionnaire_categories/#{category.id}",
            params: { name: "初診(改訂)" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(category.reload.name).to eq("初診(改訂)")
      expect(response.parsed_body["code"]).to eq(category.code)
    end

    it "reorders a category" do
      category = QuestionnaireCategory.create!(name: "初診", display_order: 1)

      patch "/admin/questionnaire_categories/#{category.id}",
            params: { display_order: 3 }, as: :json

      expect(category.reload.display_order).to eq(3)
    end

    it "deletes a category" do
      category = QuestionnaireCategory.create!(name: "初診")

      delete "/admin/questionnaire_categories/#{category.id}"

      expect(response).to have_http_status(:no_content)
      expect(QuestionnaireCategory.count).to eq(0)
    end

    it "returns 404 for a missing category" do
      patch "/admin/questionnaire_categories/999999", params: { name: "x" }, as: :json

      expect(response).to have_http_status(:not_found)
    end
  end

  # カテゴリ一覧は診療画面のテンプレート選択からも読むため、ADMIN_TOKEN を
  # 設定した環境でも認証なしで扱える(帳票レイアウトと同じ扱い)。
  describe "with ADMIN_TOKEN configured" do
    it "lists categories without credentials" do
      with_admin_token("s3cret") do
        get "/admin/questionnaire_categories"

        expect(response).to have_http_status(:ok)
      end
    end

    it "creates a category without credentials or CSRF token" do
      with_admin_token("s3cret") do
        post "/admin/questionnaire_categories", params: { name: "初診" }, as: :json

        expect(response).to have_http_status(:created)
      end
    end
  end
end
