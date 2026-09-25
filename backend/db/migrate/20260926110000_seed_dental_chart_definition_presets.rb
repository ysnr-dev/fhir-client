class SeedDentalChartDefinitionPresets < ActiveRecord::Migration[8.0]
  # 歯科の院内共通チャート(歯周病×糖尿病・口腔機能)の初期投入。本番は起動時の db:prepare で
  # seed が走らないので migration に畳む。20260924120000 と同じく同梱の JSON を丸ごと読み、
  # 同じ名前の院内共通の定義は上書きしないので、既存の 7 件には触れず歯科の 2 件だけが増える。
  # テンプレートの項目は項目コードで検索するだけなので、テンプレートが未取込でも定義は作る
  # (取り込んで記入すれば値が出る)。
  def up
    say_with_time "seed dental chart_definitions presets" do
      ChartDefinition.reset_column_information
      Master::LabResultItem.reset_column_information
      Master::Medicine.reset_column_information
      result = ChartDefinitionPresets.load!(Rails.root.join("db/seed_data/chart_definition_presets.json"))
      say "created #{result.created}, kept #{result.kept}", true
      say "skipped items: #{result.skipped_items.join(', ')}", true if result.skipped_items.any?
      result.created
    end
  end

  def down
    # 施設で直した定義を消さない。
  end
end
