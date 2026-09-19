require "rails_helper"

RSpec.describe "Admin::FileCategories", type: :request do
  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  describe "CRUD (no ADMIN_TOKEN configured)" do
    it "lists categories in display order" do
      FileCategory.create!(name: "同意書", display_order: 2)
      FileCategory.create!(name: "紹介状", display_order: 1)

      get "/admin/file_categories"

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["total"]).to eq(2)
      expect(body["items"].map { |i| i["name"] }).to eq(%w[紹介状 同意書])
      expect(body["items"].first["code"]).to be_present
    end

    it "creates a category and appends it to the end" do
      FileCategory.create!(name: "紹介状", display_order: 5)

      post "/admin/file_categories", params: { name: "同意書" }, as: :json

      expect(response).to have_http_status(:created)
      expect(response.parsed_body["display_order"]).to eq(6)
    end

    it "rejects a blank name" do
      post "/admin/file_categories", params: { name: "" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to be_present
    end

    it "rejects a duplicate name" do
      FileCategory.create!(name: "紹介状")

      post "/admin/file_categories", params: { name: "紹介状" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "renames a category without changing its code" do
      category = FileCategory.create!(name: "紹介状")

      patch "/admin/file_categories/#{category.id}", params: { name: "診療情報提供書" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(category.reload.name).to eq("診療情報提供書")
      expect(response.parsed_body["code"]).to eq(category.code)
    end

    it "reorders a category" do
      category = FileCategory.create!(name: "紹介状", display_order: 1)

      patch "/admin/file_categories/#{category.id}", params: { display_order: 3 }, as: :json

      expect(category.reload.display_order).to eq(3)
    end

    it "deletes a category" do
      category = FileCategory.create!(name: "紹介状")

      delete "/admin/file_categories/#{category.id}"

      expect(response).to have_http_status(:no_content)
      expect(FileCategory.count).to eq(0)
    end

    it "returns 404 for a missing category" do
      patch "/admin/file_categories/999999", params: { name: "x" }, as: :json

      expect(response).to have_http_status(:not_found)
    end
  end

  # カテゴリ一覧はカルテの「ファイル」タブからも読むため、管理者認証ではなく
  # アプリ本体のログイン認証で保護する(テンプレートカテゴリと同じ扱い)。
  describe "with ADMIN_TOKEN configured" do
    it "rejects reads without credentials" do
      with_admin_token("s3cret") do
        get "/admin/file_categories"

        expect(response).to have_http_status(:unauthorized)
      end
    end

    it "rejects writes without credentials" do
      with_admin_token("s3cret") do
        post "/admin/file_categories", params: { name: "紹介状" }, as: :json

        expect(response).to have_http_status(:unauthorized)
      end
    end

    it "allows CRUD with a user login session and CSRF token" do
      with_admin_token("s3cret") do
        post "/auth/session", params: { login_id: "administrator", password: "s3cret" }, as: :json
        csrf_token = response.parsed_body["csrf_token"]

        get "/admin/file_categories"
        expect(response).to have_http_status(:ok)

        post "/admin/file_categories", params: { name: "紹介状" }, as: :json,
                                       headers: { "X-CSRF-Token" => csrf_token }
        expect(response).to have_http_status(:created)
      end
    end
  end
end
