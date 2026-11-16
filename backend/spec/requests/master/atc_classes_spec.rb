require "rails_helper"

RSpec.describe "Master::AtcClasses", type: :request do
  it "取り込んで全件を入れ替え、コード順に返す" do
    Master::AtcClass.create!(code: "Z99", name: "old")

    post "/master/atc_classes/import", params: { file: fixture_file_upload("atc_classes_sample.csv", "text/csv") }
    expect(JSON.parse(response.body)["imported"]).to eq(2)

    get "/master/atc_classes"
    expect(JSON.parse(response.body)).to eq(
      [{ "code" => "C10", "name" => "LIPID MODIFYING AGENTS" }, { "code" => "C10AA", "name" => "HMG CoA reductase inhibitors" }],
    )
  end
end
