class SeedExtractQueryOrderPresets < ActiveRecord::Migration[8.0]
  # データ抽出の初期値に、部門オーダーの条件(「直近30日の放射線検査の実施」「内視鏡の依頼があり実施のない
  # 患者(90日)」「手術後30日以内の再入院」)を足す。同じ名前の院内共通の条件があれば触らない(何度実行しても同じ)。
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
