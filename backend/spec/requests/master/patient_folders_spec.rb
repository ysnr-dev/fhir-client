require "rails_helper"

RSpec.describe "Master::PatientFolders", type: :request do
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

  describe "GET /master/patient_folders" do
    before do
      common = PatientFolder.create!(scope: "facility", name: "共通")
      PatientFolder.create!(scope: "department", owner_id: "dept-1", name: "内科")
      PatientFolder.create!(scope: "department", owner_id: "dept-2", name: "外科")
      PatientFolder.create!(scope: "practitioner", owner_id: "prac-1", name: "自分")
      PatientFolder.create!(scope: "practitioner", owner_id: "prac-2", name: "他人")
      common.members.create!(patient_id: "p1")
      common.members.create!(patient_id: "p2")
    end

    it "院内共通 + 指定した診療科 + 指定した本人のフォルダを、直下の患者数つきで返す" do
      get "/master/patient_folders", params: { department_id: "dept-1", practitioner_id: "prac-1" }
      expect(response).to have_http_status(:ok)
      rows = body["items"].index_by { |i| i["name"] }
      expect(rows.keys).to contain_exactly("共通", "内科", "自分")
      expect(rows["共通"]["member_count"]).to eq(2)
      expect(rows["内科"]["member_count"]).to eq(0)
    end

    it "ログイン中は本人のフォルダだけを返す(practitioner_id のパラメータは見ない)" do
      me = User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
      with_admin_token do
        login_as(me, "password123")
        get "/master/patient_folders", params: { practitioner_id: "prac-2" }
        expect(body["items"].map { |i| i["name"] }).to contain_exactly("共通", "自分")
      end
    end
  end

  describe "POST /master/patient_folders" do
    it "同じ親の末尾に display_order を採番する" do
      parent = PatientFolder.create!(scope: "facility", name: "研究")
      post "/master/patient_folders", params: { scope: "facility", name: "A", parent_id: parent.id }, as: :json
      post "/master/patient_folders", params: { scope: "facility", name: "B", parent_id: parent.id }, as: :json
      expect(PatientFolder.where(parent_id: parent.id).ordered.pluck(:name, :display_order)).to eq([["A", 1], ["B", 2]])
    end

    it "持ち主の違う親は指定できない" do
      parent = PatientFolder.create!(scope: "practitioner", owner_id: "prac-1", name: "自分")
      post "/master/patient_folders", params: { scope: "facility", name: "A", parent_id: parent.id }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "同じ親の中で名前は重ならない" do
      PatientFolder.create!(scope: "facility", name: "A")
      post "/master/patient_folders", params: { scope: "facility", name: "A" }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "ログイン中の本人のフォルダは owner_id がログイン本人で埋まる" do
      me = User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
      with_admin_token do
        csrf = login_as(me, "password123")
        post "/master/patient_folders",
             params: { scope: "practitioner", owner_id: "prac-2", name: "A" }.to_json,
             headers: json_headers(csrf)
        expect(response).to have_http_status(:created)
        expect(body["owner_id"]).to eq("prac-1")
      end
    end
  end

  describe "PATCH /master/patient_folders/:id" do
    it "自分の子孫を親にはできない" do
      parent = PatientFolder.create!(scope: "facility", name: "親")
      child = PatientFolder.create!(scope: "facility", name: "子", parent_id: parent.id)
      patch "/master/patient_folders/#{parent.id}", params: { parent_id: child.id }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "DELETE /master/patient_folders/:id" do
    it "子フォルダが残っていれば消せない" do
      parent = PatientFolder.create!(scope: "facility", name: "親")
      PatientFolder.create!(scope: "facility", name: "子", parent_id: parent.id)
      delete "/master/patient_folders/#{parent.id}"
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "中の患者の登録も一緒に消す" do
      folder = PatientFolder.create!(scope: "facility", name: "親")
      folder.members.create!(patient_id: "p1")
      delete "/master/patient_folders/#{folder.id}"
      expect(response).to have_http_status(:no_content)
      expect(PatientFolderMember.count).to eq(0)
    end
  end

  describe "他人のフォルダ(ログイン認証あり)" do
    let!(:me) { User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1") }
    let!(:folder) { PatientFolder.create!(scope: "practitioner", owner_id: "prac-2", name: "他人") }

    it "読むことも書くこともできない" do
      folder.members.create!(patient_id: "p1")
      with_admin_token do
        csrf = login_as(me, "password123")
        get "/master/patient_folders/#{folder.id}"
        expect(response).to have_http_status(:forbidden)
        get "/master/patient_folder_members", params: { patient_folder_id: folder.id }
        expect(response).to have_http_status(:forbidden)
        post "/master/patient_folder_members",
             params: { patient_folder_id: folder.id, patient_ids: ["p2"] }.to_json, headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
        delete "/master/patient_folder_members/#{folder.members.first.id}", headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
        delete "/master/patient_folders/#{folder.id}", headers: json_headers(csrf)
        expect(response).to have_http_status(:forbidden)
      end
    end

    it "患者ごとの登録にも出さない" do
      folder.members.create!(patient_id: "p1")
      mine = PatientFolder.create!(scope: "practitioner", owner_id: "prac-1", name: "自分")
      mine.members.create!(patient_id: "p1")
      with_admin_token do
        login_as(me, "password123")
        get "/master/patient_folder_members", params: { patient_id: "p1" }
        expect(body["items"].map { |i| i["patient_folder_id"] }).to eq([mine.id])
      end
    end
  end

  describe "/master/patient_folder_members" do
    let!(:parent) { PatientFolder.create!(scope: "facility", name: "親") }
    let!(:child) { PatientFolder.create!(scope: "facility", name: "子", parent_id: parent.id) }

    it "まとめて登録し、すでに入っている患者は飛ばす" do
      parent.members.create!(patient_id: "p1")
      post "/master/patient_folder_members",
           params: { patient_folder_id: parent.id, patient_ids: %w[p1 p2 p3 p2], note: "術後" }, as: :json
      expect(response).to have_http_status(:created)
      expect(body["created"]).to eq(2)
      expect(body["skipped"]).to eq(1)
      expect(parent.members.order(:id).pluck(:patient_id, :note)).to eq([["p1", nil], ["p2", "術後"], ["p3", "術後"]])
    end

    it "下位フォルダの患者も含めて返せる" do
      parent.members.create!(patient_id: "p1")
      child.members.create!(patient_id: "p2")
      get "/master/patient_folder_members", params: { patient_folder_id: parent.id }
      expect(body["items"].map { |i| i["patient_id"] }).to eq(["p1"])
      get "/master/patient_folder_members", params: { patient_folder_id: parent.id, include_descendants: true }
      expect(body["items"].map { |i| i["patient_id"] }).to eq(%w[p1 p2])
    end

    it "患者が入っているフォルダを引ける" do
      parent.members.create!(patient_id: "p1")
      child.members.create!(patient_id: "p1")
      other = PatientFolder.create!(scope: "department", owner_id: "dept-2", name: "外科")
      other.members.create!(patient_id: "p1")
      get "/master/patient_folder_members", params: { patient_id: "p1", department_id: "dept-1" }
      expect(body["items"].map { |i| i["patient_folder_id"] }).to contain_exactly(parent.id, child.id)
    end

    it "別のフォルダへ移せる。移し先にすでに入っていれば拒む" do
      member = parent.members.create!(patient_id: "p1")
      patch "/master/patient_folder_members/#{member.id}", params: { patient_folder_id: child.id, note: "移動" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(member.reload.patient_folder_id).to eq(child.id)
      expect(member.note).to eq("移動")

      parent.members.create!(patient_id: "p1")
      patch "/master/patient_folder_members/#{member.id}", params: { patient_folder_id: parent.id }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end
