class SeedExtractQueryInterventionPreset < ActiveRecord::Migration[8.0]
  # 処方監査(docs/rx-verification-design.md)の初期データ。介入種別のマスタ(db/seed_data/pharmacist_intervention_types.csv。
  # 空だと「介入あり」を保存できない)と、データ抽出の「薬剤師介入」タブの条件(院内共通。月 × 介入種別の内訳)。
  # 本番は db:seed が流れないので migration で入れる。どちらも同じ code・同じ名前があれば触らない。
  def up
    say_with_time "seed master_pharmacist_intervention_types" do
      Master::PharmacistInterventionType.reset_column_information
      created = 0
      CSV.foreach(Rails.root.join("db/seed_data/pharmacist_intervention_types.csv"), headers: true) do |row|
        code = row["code"].to_s.strip
        next if code.blank? || Master::PharmacistInterventionType.exists?(code: code)

        Master::PharmacistInterventionType.create!(code: code, name: row["name"].to_s.strip,
                                                   display_order: row["display_order"].to_s.strip.presence&.to_i)
        created += 1
      end
      created
    end
    say_with_time "seed extract_queries intervention preset" do
      ExtractQuery.reset_column_information
      result = ExtractQueryPresets.load!(Rails.root.join("db/seed_data/extract_query_presets.json"))
      say "created #{result.created}, kept #{result.kept}, skipped #{result.skipped.join(', ')}", true
      result.created
    end
  end

  def down
    # 施設で直したマスタ・条件を消さない。
  end
end
