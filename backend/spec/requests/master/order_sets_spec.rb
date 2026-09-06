require "rails_helper"

RSpec.describe "Master::OrderSets", type: :request do
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

  def json_headers(csrf)
    { "CONTENT_TYPE" => "application/json", "X-CSRF-Token" => csrf }
  end

  def body = JSON.parse(response.body)

  describe "GET /master/order_sets" do
    before do
      OrderSet.create!(kind: "folder", scope: "facility", name: "共通")
      OrderSet.create!(kind: "set", scope: "department", owner_id: "dept-1", name: "内科セット")
      OrderSet.create!(kind: "set", scope: "department", owner_id: "dept-2", name: "外科セット")
      OrderSet.create!(kind: "set", scope: "practitioner", owner_id: "prac-1", name: "自分")
      OrderSet.create!(kind: "set", scope: "practitioner", owner_id: "prac-2", name: "他人")
    end

    it "院内共通 + 指定した診療科 + 指定した医師のノードだけを返す" do
      get "/master/order_sets", params: { department_id: "dept-1", practitioner_id: "prac-1" }
      expect(response).to have_http_status(:ok)
      expect(body["items"].map { |i| i["name"] }).to contain_exactly("共通", "内科セット", "自分")
    end

    it "指定が無いルートは院内共通だけになる" do
      get "/master/order_sets"
      expect(body["items"].map { |i| i["name"] }).to eq(["共通"])
    end

    it "entry_count を添える(フォルダは nil)" do
      set = OrderSet.find_by(name: "自分")
      set.entries.create!(order_type: "prescription", values: { "a" => 1 })
      get "/master/order_sets", params: { practitioner_id: "prac-1" }
      rows = body["items"].index_by { |i| i["name"] }
      expect(rows["自分"]["entry_count"]).to eq(1)
      expect(rows["共通"]["entry_count"]).to be_nil
    end
  end

  describe "POST /master/order_sets" do
    it "display_order を同じ親の末尾に採番する" do
      folder = OrderSet.create!(kind: "folder", scope: "facility", name: "共通")
      post "/master/order_sets", params: { kind: "set", scope: "facility", name: "A", parent_id: folder.id }, as: :json
      post "/master/order_sets", params: { kind: "set", scope: "facility", name: "B", parent_id: folder.id }, as: :json
      expect(OrderSet.where(parent_id: folder.id).ordered.pluck(:name, :display_order)).to eq([["A", 1], ["B", 2]])
    end

    it "entries を同梱して作れる" do
      post "/master/order_sets",
           params: { kind: "set", scope: "facility", name: "感冒",
                     entries: [{ order_type: "prescription", label: "PL", values: { rps: [] } },
                               { order_type: "lab-order", values: { items: [] } }] },
           as: :json
      expect(response).to have_http_status(:created)
      expect(body["entries"].map { |e| [e["order_type"], e["display_order"]] }).to eq([["prescription", 1], ["lab-order", 2]])
    end

    it "院内共通に owner_id を付けると 422" do
      post "/master/order_sets", params: { kind: "set", scope: "facility", owner_id: "x", name: "A" }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "持ち主の違うフォルダを親にすると 422" do
      folder = OrderSet.create!(kind: "folder", scope: "department", owner_id: "dept-1", name: "内科")
      post "/master/order_sets", params: { kind: "set", scope: "facility", name: "A", parent_id: folder.id }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "セットを親にすると 422" do
      parent = OrderSet.create!(kind: "set", scope: "facility", name: "A")
      post "/master/order_sets", params: { kind: "set", scope: "facility", name: "B", parent_id: parent.id }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "不正な order_type のエントリは 422" do
      post "/master/order_sets",
           params: { kind: "set", scope: "facility", name: "A", entries: [{ order_type: "bogus", values: {} }] },
           as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(OrderSet.count).to eq(0)
    end
  end

  describe "PATCH /master/order_sets/:id" do
    it "自分自身や子孫を親にできない" do
      root = OrderSet.create!(kind: "folder", scope: "facility", name: "root")
      child = OrderSet.create!(kind: "folder", scope: "facility", name: "child", parent_id: root.id)
      patch "/master/order_sets/#{root.id}", params: { parent_id: child.id }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      patch "/master/order_sets/#{root.id}", params: { parent_id: root.id }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PUT /master/order_sets/:id/entries" do
    it "全置換して display_order を振り直す" do
      set = OrderSet.create!(kind: "set", scope: "facility", name: "A")
      3.times { |i| set.entries.create!(order_type: "prescription", display_order: i + 1, values: {}) }
      put "/master/order_sets/#{set.id}/entries",
          params: { entries: [{ order_type: "lab-order", values: { x: 1 } }, { order_type: "rad-order", values: {} }] },
          as: :json
      expect(response).to have_http_status(:ok)
      expect(set.entries.reload.pluck(:order_type, :display_order)).to eq([["lab-order", 1], ["rad-order", 2]])
      expect(set.entries.first.values).to eq({ "x" => 1 })
    end

    it "フォルダには登録できない" do
      folder = OrderSet.create!(kind: "folder", scope: "facility", name: "F")
      put "/master/order_sets/#{folder.id}/entries", params: { entries: [] }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "DELETE /master/order_sets/:id" do
    it "子が残っているフォルダは消せない" do
      folder = OrderSet.create!(kind: "folder", scope: "facility", name: "F")
      OrderSet.create!(kind: "set", scope: "facility", name: "A", parent_id: folder.id)
      delete "/master/order_sets/#{folder.id}"
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "セットは entries ごと消える" do
      set = OrderSet.create!(kind: "set", scope: "facility", name: "A")
      set.entries.create!(order_type: "prescription", values: {})
      delete "/master/order_sets/#{set.id}"
      expect(response).to have_http_status(:no_content)
      expect(OrderSetEntry.count).to eq(0)
    end
  end

  describe "POST /master/order_sets/:id/copy" do
    it "code を新規に採番し entries を写す" do
      set = OrderSet.create!(kind: "set", scope: "practitioner", owner_id: "prac-1", name: "A")
      set.entries.create!(order_type: "prescription", label: "PL", values: { a: 1 })
      post "/master/order_sets/#{set.id}/copy", params: { scope: "facility", name: "A(共通)" }, as: :json
      expect(response).to have_http_status(:created)
      expect(body["code"]).not_to eq(set.code)
      expect(body["scope"]).to eq("facility")
      expect(body["owner_id"]).to be_nil
      expect(body["entries"].map { |e| e["label"] }).to eq(["PL"])
      expect(set.entries.reload.count).to eq(1)
    end
  end

  describe "医師スコープの持ち主(ログイン認証あり)" do
    let!(:me) { User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1") }
    let!(:other) { User.create!(login_id: "suzuki", password: "password123", practitioner_fhir_id: "prac-2") }

    it "owner_id はパラメータではなくログイン本人で埋まる" do
      with_admin_token do
        csrf = login_as(me, "password123")
        post "/master/order_sets",
             params: { kind: "set", scope: "practitioner", owner_id: "prac-2", name: "A" }.to_json,
             headers: json_headers(csrf)
        expect(response).to have_http_status(:created)
        expect(body["owner_id"]).to eq("prac-1")
      end
    end

    it "他人の医師セットは更新・削除・エントリ置換できない(読み取りはできる)" do
      set = OrderSet.create!(kind: "set", scope: "practitioner", owner_id: "prac-2", name: "他人")
      with_admin_token do
        csrf = login_as(me, "password123")
        get "/master/order_sets/#{set.id}"
        expect(response).to have_http_status(:ok)
        patch "/master/order_sets/#{set.id}", params: { name: "x" }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
        put "/master/order_sets/#{set.id}/entries", params: { entries: [] }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
        delete "/master/order_sets/#{set.id}", headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
        csrf = login_as(other, "password123")
        patch "/master/order_sets/#{set.id}", params: { name: "x" }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:ok)
      end
    end

    it "administrator は医師セットを作れない" do
      with_admin_token do
        post "/auth/session", params: { login_id: "administrator", password: admin_token }, as: :json
        csrf = JSON.parse(response.body).fetch("csrf_token")
        post "/master/order_sets",
             params: { kind: "set", scope: "practitioner", name: "A" }.to_json,
             headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
      end
    end
  end
end
