class CreateMasterMealDiets < ActiveRecord::Migration[8.0]
  # 食種を master_meal_items から独立したテーブルに分ける(docs/meal-order-design.md §3)。
  #
  # 当初は食種・主食・副食形態を「列構成が同じ」として 1 テーブルに入れていたが、
  # 食止め(is_fasting)・種別(category_code)に続いて主成分量(§3.3)と適応を持たせると
  # 食種専用の列が共通の列より多くなり、「主食には入れられない」検証を重ねる形に
  # なるので分けた。主食・副食形態(・将来の嗜好品・補助食)は「コードと名称のリスト」の
  # ままで、こちらは master_meal_items に残る。
  #
  # FHIR 側は CodeSystem の URI(meal-type / meal-staple-food / meal-side-dish-form)で
  # 既に区別しているので無変更。
  #
  # 本番ではまだ食事オーダーを使っていないので、既存データの移送は開発環境の便宜
  # (数件の食種を入れ直さなくて済む)として最小限の INSERT ... SELECT だけ置く。
  def up
    create_table :master_meal_diets do |t|
      t.string :item_code, null: false # 独自採番の食種コード。NPO などの手入力も可
      t.string :name, null: false      # 一般食2000kcal・糖尿病食1600kcal・食止め など
      t.string :name_kana              # カナ名称。検索用の入力元
      # 食止め(禁食)の食種か。SS-MIX2 は食止めを食種の 1 コード(NPO)として扱うので
      # 食種の一種として持ち、オーダー側に「食止めフラグ」は作らない。
      t.boolean :is_fasting, null: false, default: false
      # 種別(master_meal_categories.category_code)。未分類もありうるので NULL 可。
      t.string :category_code

      # 主成分量。1 日あたり(朝昼夕の合計)の標準値。単位は列名に焼き込む。
      # 全て任意で、食止めは空のまま。合計整合(蛋白 4 + 脂質 9 + 糖質 4 ≒ 熱量)は
      # 端数と食物繊維で必ずずれるので検証しない。
      t.decimal :energy_kcal, precision: 7, scale: 1
      t.decimal :protein_g, precision: 6, scale: 1
      t.decimal :fat_g, precision: 6, scale: 1
      t.decimal :carbohydrate_g, precision: 6, scale: 1 # 画面表記は「糖質」
      t.decimal :water_ml, precision: 7, scale: 1
      # 食種の標準塩分量。オーダーの塩分制限(meal-salt-limit 拡張、患者ごとの指示)とは別物。
      t.decimal :salt_g, precision: 5, scale: 1
      # 適応・備考。オーダー画面の食種選択で医師に見せる文。note はマスタ管理者の控え。
      t.text :indication

      t.date :valid_from               # 有効開始日
      t.date :valid_to                 # 有効終了日。期限を過ぎた食種は選択肢に出さない
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_meal_diets, :item_code, unique: true
    add_index :master_meal_diets, :category_code

    execute <<~SQL
      INSERT INTO master_meal_diets
        (item_code, name, name_kana, is_fasting, category_code, valid_from, valid_to,
         display_order, note, search_name, search_kana, created_at, updated_at)
      SELECT item_code, name, name_kana, is_fasting, category_code, valid_from, valid_to,
             display_order, note, search_name, search_kana, created_at, updated_at
      FROM master_meal_items WHERE kind = 'diet'
    SQL
    execute "DELETE FROM master_meal_items WHERE kind = 'diet'"

    remove_index :master_meal_items, :category_code
    remove_column :master_meal_items, :category_code, :string
    remove_column :master_meal_items, :is_fasting, :boolean
    change_column_default :master_meal_items, :kind, from: "diet", to: "staple"
  end

  def down
    change_column_default :master_meal_items, :kind, from: "staple", to: "diet"
    add_column :master_meal_items, :is_fasting, :boolean, null: false, default: false
    add_column :master_meal_items, :category_code, :string
    add_index :master_meal_items, :category_code
    execute <<~SQL
      INSERT INTO master_meal_items
        (item_code, name, name_kana, kind, is_fasting, category_code, valid_from, valid_to,
         display_order, note, search_name, search_kana, created_at, updated_at)
      SELECT item_code, name, name_kana, 'diet', is_fasting, category_code, valid_from, valid_to,
             display_order, note, search_name, search_kana, created_at, updated_at
      FROM master_meal_diets
    SQL
    drop_table :master_meal_diets
  end
end
