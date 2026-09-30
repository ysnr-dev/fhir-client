require "rails_helper"

RSpec.describe "Master::BulletinPosts", type: :request do
  let(:admin_token) { "s3cret-admin-passphrase" }

  def with_admin_token(token = admin_token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  def login_as(user, password)
    post "/auth/session", params: { login_id: user.login_id, password: password }, as: :json
    JSON.parse(response.body).fetch("csrf_token")
  end

  def login_as_administrator
    post "/auth/session", params: { login_id: "administrator", password: admin_token }, as: :json
    JSON.parse(response.body).fetch("csrf_token")
  end

  def json_headers(csrf)
    { "CONTENT_TYPE" => "application/json", "X-CSRF-Token" => csrf }
  end

  def body = JSON.parse(response.body)

  let(:today) { Time.zone.today }

  describe "GET /master/bulletin_posts" do
    before do
      BulletinPost.create!(title: "古い", published_from: today - 10, published_until: today - 1)
      BulletinPost.create!(title: "今日から", published_from: today)
      BulletinPost.create!(title: "先週から", published_from: today - 7, published_until: today + 7)
      BulletinPost.create!(title: "固定", pinned: true, published_from: today - 30)
      BulletinPost.create!(title: "明日から", published_from: today + 1)
    end

    it "固定を先頭に、掲載開始日の新しい順で全件返す" do
      get "/master/bulletin_posts"
      expect(response).to have_http_status(:ok)
      expect(body["items"].map { |i| i["title"] }).to eq(%w[固定 明日から 今日から 先週から 古い])
      expect(body["items"].map { |i| i["current"] }).to eq([true, false, true, true, false])
    end

    it "current=true で今日掲載中のものだけになる" do
      get "/master/bulletin_posts", params: { current: "true", per: 2 }
      expect(body["total"]).to eq(3)
      expect(body["items"].map { |i| i["title"] }).to eq(%w[固定 今日から])
    end

    it "date で画面の今日を受け取る(サーバーの時計とずれる朝 9 時前のため)" do
      get "/master/bulletin_posts", params: { current: "true", date: (today + 1).iso8601 }
      expect(body["items"].map { |i| i["title"] }).to eq(%w[固定 明日から 今日から 先週から])
      get "/master/bulletin_posts", params: { current: "true", date: "not-a-date" }
      expect(body["total"]).to eq(3)
    end
  end

  describe "POST /master/bulletin_posts" do
    it "掲載開始日を省略すると今日になる" do
      post "/master/bulletin_posts", params: { title: "お知らせ", body: "本文" }, as: :json
      expect(response).to have_http_status(:created)
      expect(body).to include("title" => "お知らせ", "body" => "本文", "pinned" => false,
                              "published_from" => today.iso8601, "published_until" => nil, "current" => true)
    end

    it "掲載終了日が開始日より前なら 422" do
      post "/master/bulletin_posts",
           params: { title: "x", published_from: today, published_until: today - 1 }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].join).to include("掲載終了日")
    end

    it "件名が無ければ 422" do
      post "/master/bulletin_posts", params: { body: "本文だけ" }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "投稿者と認可" do
    let(:tanaka) { User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1") }
    let(:suzuki) { User.create!(login_id: "suzuki", password: "password123", practitioner_fhir_id: "prac-2") }

    it "投稿者はログイン本人で記録し、本人だけが直せる" do
      with_admin_token do
        csrf = login_as(tanaka, "password123")
        post "/master/bulletin_posts",
             params: { title: "当直交代", author_id: "prac-9", author_name: "田中" }.to_json,
             headers: json_headers(csrf)
        expect(response).to have_http_status(:created)
        expect(body).to include("author_id" => "prac-1", "author_name" => "田中", "editable" => true)
        id = body["id"]

        patch "/master/bulletin_posts/#{id}", params: { title: "当直交代(改)" }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:ok)
        expect(body["title"]).to eq("当直交代(改)")

        delete "/auth/session", headers: json_headers(csrf)
        csrf = login_as(suzuki, "password123")
        get "/master/bulletin_posts/#{id}"
        expect(body["editable"]).to be(false)
        patch "/master/bulletin_posts/#{id}", params: { title: "書き換え" }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
        delete "/master/bulletin_posts/#{id}", headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
      end
    end

    it "administrator は誰の投稿でも直せて消せる" do
      post = BulletinPost.create!(title: "誰かの", author_id: "prac-1", author_name: "田中")
      with_admin_token do
        csrf = login_as_administrator
        get "/master/bulletin_posts/#{post.id}"
        expect(body["editable"]).to be(true)
        patch "/master/bulletin_posts/#{post.id}", params: { pinned: true }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:ok)
        expect(body).to include("pinned" => true, "author_id" => "prac-1")
        delete "/master/bulletin_posts/#{post.id}", headers: json_headers(csrf)
        expect(response).to have_http_status(:no_content)
      end
    end

    it "administrator の投稿は表示名が管理者になる" do
      with_admin_token do
        csrf = login_as_administrator
        post "/master/bulletin_posts", params: { title: "管理者から" }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:created)
        expect(body).to include("author_id" => nil, "author_name" => "管理者")
      end
    end

    it "認証なしモードでは誰でも直せる" do
      post = BulletinPost.create!(title: "誰かの", author_id: "prac-1")
      patch "/master/bulletin_posts/#{post.id}", params: { title: "直した" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(body["editable"]).to be(true)
    end
  end
end
