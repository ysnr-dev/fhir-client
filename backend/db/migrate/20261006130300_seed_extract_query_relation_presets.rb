class SeedExtractQueryRelationPresets < ActiveRecord::Migration[8.0]
  # データ抽出の初期値に、時間関係を使う条件(「退院後30日以内の再入院」「2型糖尿病の開始から90日以内に
  # HbA1c未測定」)を足す。同じ名前の院内共通の条件があれば触らない(何度実行しても同じ)。
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
