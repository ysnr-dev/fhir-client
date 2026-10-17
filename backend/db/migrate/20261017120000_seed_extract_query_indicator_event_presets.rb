class SeedExtractQueryIndicatorEventPresets < ActiveRecord::Migration[8.0]
  # データ抽出の「指標」タブ(再入院率・HbA1c 7.0 未満の割合・細菌検査提出率)・「イベント」タブ(再入院までの日数・
  # 診断から腎症まで)・基準日つきの検査結果タブの条件(院内共通)の初期投入と、見本のダッシュボードへのタイルの追加。db:seed と同じ ExtractQueryPresets を呼び、同じタブに同じ名前の
  # 院内共通の条件があれば触らない。ダッシュボードは同じ名前があれば触らない(DashboardPresets)。
  def up
    say_with_time "seed extract_queries indicator / event presets" do
      ExtractQuery.reset_column_information
      result = ExtractQueryPresets.load!(Rails.root.join("db/seed_data/extract_query_presets.json"))
      say "created #{result.created}, kept #{result.kept}, skipped #{result.skipped.join(', ')}", true
      result.created
    end
    say_with_time "seed dashboard presets" do
      result = DashboardPresets.load!(Rails.root.join("db/seed_data/dashboard_presets.json"))
      say "created #{result.created}, kept #{result.kept}", true
      result.created
    end
  end

  def down
    # 施設で直した条件・ダッシュボードを消さない。
  end
end
