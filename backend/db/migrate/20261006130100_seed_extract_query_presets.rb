class SeedExtractQueryPresets < ActiveRecord::Migration[8.0]
  # データ抽出の条件(院内共通)の初期投入。本番は起動時の db:prepare で seed が走らず、
  # Shell も無いので migration に畳む(db:seed と同じ ExtractQueryPresets を呼ぶ)。
  # 同じ名前の院内共通の条件があれば上書きしない(何度実行しても同じ)。
  def up
    say_with_time "seed extract_queries presets" do
      ExtractQuery.reset_column_information
      result = ExtractQueryPresets.load!(Rails.root.join("db/seed_data/extract_query_presets.json"))
      say "created #{result.created}, kept #{result.kept}", true
      result.created
    end
  end

  def down
    # 施設で直した条件を消さない。テーブルごと消すのは create migration の down。
  end
end
