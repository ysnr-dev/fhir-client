class SeedExtractQueryAntibioticPreset < ActiveRecord::Migration[8.0]
  # データ抽出の初期値に「抗菌薬の注射が30日に2回以上」(薬効分類・処方/注射の区別・件数の
  # 閾値を使う条件)を足す。同じ名前の院内共通の条件があれば触らない(何度実行しても同じ)。
  def up
    say_with_time "seed extract_queries presets" do
      ExtractQuery.reset_column_information
      result = ExtractQueryPresets.load!(Rails.root.join("db/seed_data/extract_query_presets.json"))
      say "created #{result.created}, kept #{result.kept}", true
      result.created
    end
  end

  def down; end
end
