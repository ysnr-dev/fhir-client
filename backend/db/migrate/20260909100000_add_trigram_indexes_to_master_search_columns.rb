class AddTrigramIndexesToMasterSearchColumns < ActiveRecord::Migration[8.0]
  # マスタの名称検索(Master::BaseController#flexible_name_match ほか)は正規化した
  # search_* 列への `LIKE '%token%'` で、前方一致でないため btree 索引が効かず全表走査に
  # なっていた(医薬品 1.9 万行・病名 2.8 万行・HOT 3.8 万行)。pg_trgm の GIN 索引は
  # 中間一致の LIKE / ILIKE にそのまま効く(3 文字未満のトークンは索引を使わず走査に戻る)。
  def change
    enable_extension "pg_trgm"

    trigram :master_medicines, %i[search_name search_kana search_generic]
    trigram :master_diseases, %i[search_name search_kana]
    trigram :master_disease_indexes, %i[search_term]
    trigram :master_medical_procedures, %i[search_name search_kana]
    trigram :master_regimens, %i[search_name search_kana search_short_name]
    trigram :master_medicine_types, %i[search_name]
    # 販売名は ILIKE で引く(hot_codes_controller)。
    trigram :master_hot_codes, %i[sales_name]

    # 診療行為一覧の並び順。索引が無く毎回ソートしていた。
    add_index :master_medical_procedures, :publication_order
  end

  private

  def trigram(table, columns)
    columns.each do |column|
      add_index table, column, using: :gin, opclass: :gin_trgm_ops, name: "idx_#{table}_#{column}_trgm"
    end
  end
end
