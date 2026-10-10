class SeedExtractQueryLabPresets < ActiveRecord::Migration[8.0]
  # データ抽出の検査結果タブの条件(院内共通)の初期投入。群分けの例「HbA1c 8以上 薬効群別の推移」と、
  # 担当医と区切りの例「医師別 HbA1c コントロール」。db:seed と同じ ExtractQueryPresets を呼び、
  # 同じタブに同じ名前の院内共通の条件があれば触らない。
  def up
    say_with_time "seed extract_queries lab presets" do
      ExtractQuery.reset_column_information
      result = ExtractQueryPresets.load!(Rails.root.join("db/seed_data/extract_query_presets.json"))
      say "created #{result.created}, kept #{result.kept}", true
      result.created
    end
  end

  def down
    # 施設で直した条件を消さない。
  end
end
