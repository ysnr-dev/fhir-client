class SeedPressureUlcerChartDefinitionPreset < ActiveRecord::Migration[8.0]
  # 褥瘡(DESIGN-R)の院内共通チャートの初期投入(docs/care-team-design.md §6)。20260926110000 と同じく
  # 同梱の JSON を丸ごと読み、同じ名前の院内共通の定義は上書きしないので、既存の定義には触れず 1 件だけ増える。
  # テンプレート(PU_DESIGNR_01)が未取込でも定義は作る(取り込んで記入すれば値が出る)。
  def up
    say_with_time "seed pressure ulcer chart_definitions preset" do
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
