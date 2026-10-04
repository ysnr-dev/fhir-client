require "rails_helper"

RSpec.describe "Master::NursingTerms", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_term(**attrs)
    Master::NursingTerm.create!({ taxonomy: "diagnosis", source: "local" }.merge(attrs))
  end

  def seed_tree
    create_term(level: "domain", code: "LD1", name: "安全")
    create_term(level: "class", code: "LC1", parent_code: "LD1", name: "身体損傷")
    create_term(level: "term", code: "L001", parent_code: "LC1", name: "転倒転落の危険がある状態",
                diagnosis_type: "risk", items: [{ item_type: "risk_factor", code: "R1", name: "歩行が不安定" }])
  end

  it "taxonomy・階層・コード・名称で絞り込む" do
    seed_tree
    Master::NursingTerm.create!(taxonomy: "outcome", level: "domain", code: "LD1", name: "安全の成果")

    get "/master/nursing_terms", params: { taxonomy: "diagnosis" }
    expect(body["items"].map { |i| i["code"] }).to contain_exactly("LD1", "LC1", "L001")

    get "/master/nursing_terms", params: { taxonomy: "diagnosis", level: "term", q: "転倒" }
    expect(body["items"].map { |i| i["code"] }).to eq(%w[L001])
    expect(body["items"].first["items"]).to eq([{ "item_type" => "risk_factor", "code" => "R1", "name" => "歩行が不安定" }])

    get "/master/nursing_terms", params: { taxonomy: "diagnosis", code: "LC1,L001" }
    expect(body["items"].map { |i| i["code"] }).to contain_exactly("LC1", "L001")
  end

  it "作成・更新でき、付随項目は空行と知らないキーを落とす" do
    seed_tree
    post "/master/nursing_terms",
         params: { taxonomy: "diagnosis", level: "term", code: "L002", parent_code: "LC1", name: "感染の危険がある状態",
                   diagnosis_type: "risk",
                   items: [{ item_type: "risk_factor", code: "", name: "留置カテーテル" }, { item_type: "risk_factor", name: "" }] },
         as: :json
    expect(response).to have_http_status(:created)
    expect(body["items"]).to eq([{ "item_type" => "risk_factor", "code" => "", "name" => "留置カテーテル" }])

    patch "/master/nursing_terms/#{body['id']}", params: { guidance: "術後は毎日評価する" }, as: :json
    expect(Master::NursingTerm.find(body["id"]).guidance).to eq("術後は毎日評価する")
  end

  it "親の階層が合わない行と、種類の合わない付随項目を拒む" do
    seed_tree
    post "/master/nursing_terms",
         params: { taxonomy: "diagnosis", level: "term", code: "L003", parent_code: "LD1", name: "x" }, as: :json
    expect(response).to have_http_status(:unprocessable_content)

    post "/master/nursing_terms",
         params: { taxonomy: "diagnosis", level: "term", code: "L003", parent_code: "LC1", name: "x",
                   items: [{ item_type: "indicator", name: "指標" }] }, as: :json
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "配下のある領域・類は削除できない" do
    seed_tree
    domain = Master::NursingTerm.find_by!(code: "LD1")

    delete "/master/nursing_terms/#{domain.id}"
    expect(response).to have_http_status(:unprocessable_content)

    delete "/master/nursing_terms/#{Master::NursingTerm.find_by!(code: 'L001').id}"
    expect(response).to have_http_status(:no_content)
  end
end
