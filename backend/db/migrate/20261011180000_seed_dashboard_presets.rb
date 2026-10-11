class SeedDashboardPresets < ActiveRecord::Migration[8.0]
  # ダッシュボードの見本(院内共通)の初期投入。院内共通のデータ抽出の条件を名前で指して並べる。
  # db:seed と同じ DashboardPresets を呼び、同じ名前の院内共通のダッシュボードがあれば触らない。
  def up
    say_with_time "seed dashboard presets" do
      Dashboard.reset_column_information
      result = DashboardPresets.load!(Rails.root.join("db/seed_data/dashboard_presets.json"))
      say "created #{result.created}, kept #{result.kept}", true
      say "missing queries: #{result.missing.join(", ")}", true if result.missing.any?
      result.created
    end
  end

  def down
    # 施設で直したダッシュボードを消さない。
  end
end
