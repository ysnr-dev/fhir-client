require "rails_helper"

RSpec.describe DashboardPresets do
  let(:path) { Rails.root.join("db/seed_data/dashboard_presets.json") }

  before { ExtractQueryPresets.load!(Rails.root.join("db/seed_data/extract_query_presets.json")) }

  it "同梱の見本のタイルがすべて院内共通の条件を指し、ダッシュボードの検証に通る" do
    result = described_class.load!(path)

    expect(result.missing).to eq([])
    expect(result.created).to eq(JSON.parse(File.read(path)).size)
    Dashboard.where(scope: "facility").find_each do |dashboard|
      expect(dashboard).to be_valid
      codes = dashboard.definition["tiles"].map { |tile| tile["query_code"] }
      expect(ExtractQuery.where(code: codes).distinct.count(:code)).to eq(codes.uniq.size)
    end
    trend = ExtractQuery.find_by!(scope: "facility", tab: "lab", name: "医師別 HbA1c コントロール")
    expect(Dashboard.find_by!(name: "糖尿病外来").definition["tiles"]).to include(
      include("query_code" => trend.code, "view" => "breakdown")
    )
  end

  it "同じ名前の院内共通のダッシュボードは触らず、見つからない条件のタイルは置かない" do
    described_class.load!(path)
    again = described_class.load!(path)
    expect(again.created).to eq(0)

    result = described_class.new([{ "name" => "条件なし", "tiles" => [
      { "query_name" => "直近30日の入院", "view" => "count", "x" => 0, "y" => 0, "w" => 3, "h" => 2 },
      { "query_name" => "存在しない条件", "view" => "count", "x" => 3, "y" => 0, "w" => 3, "h" => 2 }
    ] }]).load!
    expect(result.missing).to eq(["条件なし: 存在しない条件"])
    expect(Dashboard.find_by!(name: "条件なし").definition["tiles"].map { |t| t["id"] }).to eq(%w[t1])
  end
end
