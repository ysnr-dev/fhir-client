require "rails_helper"

RSpec.describe "Master::NursingObservations", type: :request do
  def body
    JSON.parse(response.body)
  end

  def create_obs(manage_no, name, overrides = {})
    Master::NursingObservation.create!({
      manage_no: manage_no, name: name, kana: "", active: true,
      search_name: Master::SearchNormalizer.normalize(name), search_kana: ""
    }.merge(overrides))
  end

  before do
    create_obs("31000001", "SpO2", search_category_1: "1", search_category_5: "1")
    create_obs("31000030", "便量", search_category_3: "2", search_category_4: "6")
    create_obs("31000017", "中心静脈栄養", active: false)
  end

  it "既定は有効な用語だけを返す" do
    get "/master/nursing_observations"
    expect(body["items"].map { |i| i["manage_no"] }).to eq(%w[31000001 31000030])
  end

  it "検索大分類で絞り込める" do
    get "/master/nursing_observations", params: { category: "3" }
    expect(body["items"].map { |i| i["manage_no"] }).to eq(%w[31000030])
  end

  it "名称で検索できる" do
    get "/master/nursing_observations", params: { name: "便" }
    expect(body["items"].map { |i| i["manage_no"] }).to eq(%w[31000030])
  end

  it "取込できる" do
    file = Rack::Test::UploadedFile.new(Rails.root.join("spec/fixtures/files/nursing_observations_sample.txt"), "text/plain")
    post "/master/nursing_observations/import", params: { file: file }
    expect(body["imported"]).to eq(3)
  end
end
