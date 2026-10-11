class SeedExtractQueryDiabetesPresets < ActiveRecord::Migration[8.0]
  # データ抽出の糖尿病の条件(院内共通)の初期投入。「患者」タブの受診中断・低血糖・腎症の病名漏れなどと、
  # それを使う検査結果・投薬・病名・入院・外来タブの条件。db:seed と同じ ExtractQueryPresets を呼び、
  # 同じタブに同じ名前の院内共通の条件があれば触らない。
  def up
    say_with_time "seed extract_queries diabetes presets" do
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
