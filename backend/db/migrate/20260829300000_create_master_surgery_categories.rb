class CreateMasterSurgeryCategories < ActiveRecord::Migration[8.0]
  # 術式の種別(分類)マスタ。生理検査の master_physio_exam_types に当たる分類軸だが、
  # 手術は分類が「部位の大分類 → その中の細分類」と入れ子になるので、1 段では足りない。
  # 医科点数表 第2章第10部 手術 第1節 手術料 が「第9款 腹部 → 胃、食道、腸、他」と
  # 段を持つのと同じ形にする。
  #
  # 段数を列(大分類・中分類)で固定せず parent_code の自己参照にしたのは、
  # 施設によって「款まで」「区分まで」と使う深さが違い、点数表の改定でも段が
  # 増えうるため。外部キーは他のマスタと同じく張らず、コードで緩く参照する。
  def change
    create_table :master_surgery_categories do |t|
      # 独自採番のコード。自動採番では親コードに2桁を足していく("09" → "0901")が、
      # 手入力の任意コードも許すので、コードから親を導かず parent_code で持つ。
      t.string :category_code, null: false
      t.string :name, null: false      # 分類名(腹部・胃、食道、腸、他 など)
      t.string :name_kana              # カナ名称。検索用の入力元
      # 親分類の category_code。NULL は最上位。
      t.string :parent_code

      t.date :valid_from               # 有効開始日
      t.date :valid_to                 # 有効終了日。期限を過ぎた分類は選択肢に出さない
      t.integer :display_order         # 同じ親の中での並び順
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_surgery_categories, :category_code, unique: true
    add_index :master_surgery_categories, :parent_code

    # 術式が属する種別(master_surgery_categories.category_code)。未分類もありうる
    # ので NULL 可。最上位でも末端でも、どの段のコードでも入れてよい。
    add_column :master_surgery_items, :category_code, :string
    add_index :master_surgery_items, :category_code
  end
end
