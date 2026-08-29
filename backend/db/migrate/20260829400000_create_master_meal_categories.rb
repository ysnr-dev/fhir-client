class CreateMasterMealCategories < ActiveRecord::Migration[8.0]
  # 食種の種別(分類)マスタ。一般食・特別食(治療食)・その他 のように食種をまとめる。
  # 生理検査の master_physio_exam_types と同じ 1 段の分類で、手術(第10部の款・区分に
  # 合わせて入れ子にした master_surgery_categories)と違い階層は持たない。
  # 食種の分類は「一般食か特別食か」程度の粒度で、入れ子にする実務上の理由が無い。
  #
  # 主食(kind = staple)には付けない。分類したいのは食種だけなので、種別マスタに
  # 食種用と主食用が混ざらないようにする(master_meal_items 側で検証する)。
  def change
    create_table :master_meal_categories do |t|
      t.string :category_code, null: false # 独自採番の2桁("01" 〜 "99")
      t.string :name, null: false          # 分類名(一般食・特別食 など)
      t.string :name_kana                  # カナ名称。検索用の入力元

      t.date :valid_from                   # 有効開始日
      t.date :valid_to                     # 有効終了日。期限切れは選択肢に出さない
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_meal_categories, :category_code, unique: true

    # 食種が属する種別(master_meal_categories.category_code)。未分類もありうるので
    # NULL 可。主食(kind = staple)には入れない。
    add_column :master_meal_items, :category_code, :string
    add_index :master_meal_items, :category_code
  end
end
