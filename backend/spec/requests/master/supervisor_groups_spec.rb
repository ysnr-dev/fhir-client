require "rails_helper"

RSpec.describe "Master::SupervisorGroups", type: :request do
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

  def body = JSON.parse(response.body)

  let!(:internal) { SupervisorGroup.create!(name: "内科研修") }
  let!(:surgery) { SupervisorGroup.create!(name: "外科研修") }

  before do
    internal.members.create!(practitioner_fhir_id: "dr-a", display_name: "指導 太郎", role: "supervisor")
    internal.members.create!(practitioner_fhir_id: "dr-b", display_name: "指導 次郎", role: "supervisor")
    internal.members.create!(practitioner_fhir_id: "res-1", display_name: "研修 一郎", role: "trainee")
    surgery.members.create!(practitioner_fhir_id: "dr-b", display_name: "指導 次郎", role: "supervisor")
    surgery.members.create!(practitioner_fhir_id: "res-2", display_name: "研修 二郎", role: "trainee")
  end

  describe "GET /master/supervisor_groups" do
    it "グループを名前順に、構成員付きで返す" do
      get "/master/supervisor_groups"

      expect(response).to have_http_status(:ok)
      expect(body.map { |g| g["name"] }).to eq(%w[外科研修 内科研修].sort)
      members = body.find { |g| g["name"] == "内科研修" }["members"]
      expect(members.map { |m| m.values_at("practitioner_fhir_id", "role") }).to eq([
        ["dr-a", "supervisor"], ["dr-b", "supervisor"], ["res-1", "trainee"],
      ])
    end
  end

  describe "POST /master/supervisor_groups" do
    it "名前は重複できない" do
      post "/master/supervisor_groups", params: { name: "内科研修" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "DELETE /master/supervisor_groups/:id" do
    it "構成員ごと消える" do
      delete "/master/supervisor_groups/#{internal.id}"

      expect(response).to have_http_status(:no_content)
      expect(SupervisorGroupMember.where(supervisor_group_id: internal.id)).to be_empty
    end
  end

  describe "POST /master/supervisor_group_members" do
    it "同じ人を同じグループに二度入れられない" do
      post "/master/supervisor_group_members",
           params: { supervisor_group_id: internal.id, practitioner_fhir_id: "dr-a", role: "trainee" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "役割は指導医か研修医だけ" do
      post "/master/supervisor_group_members",
           params: { supervisor_group_id: internal.id, practitioner_fhir_id: "x", role: "nurse" }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "GET /master/supervisor_groups/mine" do
    it "指導医は受け持つ研修医を、研修医は指導医をグループをまたいで重複なく返す" do
      get "/master/supervisor_groups/mine", params: { practitioner_id: "dr-b" }
      expect(body["supervisors"]).to eq([])
      expect(body["trainees"].map { |m| m["practitioner_fhir_id"] }).to eq(%w[res-1 res-2])

      get "/master/supervisor_groups/mine", params: { practitioner_id: "res-1" }
      expect(body["supervisors"].map { |m| m["practitioner_fhir_id"] }).to eq(%w[dr-a dr-b])
      expect(body["trainees"]).to eq([])
    end

    it "セッションでログインしているときは本人の id を使う(渡された id は見ない)" do
      user = User.create!(login_id: "res1", password: "res1-password", practitioner_fhir_id: "res-1")
      with_admin_token do
        login_as(user, "res1-password")
        get "/master/supervisor_groups/mine", params: { practitioner_id: "dr-b" }
      end

      expect(body["supervisors"].map { |m| m["practitioner_fhir_id"] }).to eq(%w[dr-a dr-b])
    end

    it "誰か分からなければ空" do
      get "/master/supervisor_groups/mine"

      expect(body).to eq("supervisors" => [], "trainees" => [])
    end
  end
end
