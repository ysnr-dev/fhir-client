class SeedChartDefinitionPresets < ActiveRecord::Migration[8.0]
  # 疾患別のチャート定義(院内共通)の初期投入。本番は起動時の db:prepare で seed が走らず、
  # Shell も無いので migration に畳む(db:seed と同じ ChartDefinitionPresets を呼ぶ)。
  # 検査項目は結果項目マスタ、薬剤のレセ電コードは薬剤マスタから引く。薬剤マスタが未取込でも
  # YJ 先頭 7 桁で突き合わせられるので定義は作る。
  # 同じ名前の院内共通の定義があれば上書きしない(何度実行しても同じ)。
  def up
    say_with_time "seed chart_definitions presets" do
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
    # 施設で直した定義を消さない。テーブルごと消すのは create migration の down。
  end
end
