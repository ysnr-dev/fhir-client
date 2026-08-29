class CreateMasterTransfusionProducts < ActiveRecord::Migration[8.0]
  # 輸血製剤マスタ。赤血球液・新鮮凍結血漿・濃厚血小板・自己血などを登録する。
  #
  # 食事(master_meal_items)と同じ単純編集型で、配布マスタの取込は持たない。
  # 日本赤十字社の製品に配布形式の標準マスタが無く、施設で扱う製剤も数十件に
  # とどまるため、画面から手で入れる(docs/transfusion-order-design.md §3)。
  #
  # セット・伝票レイアウト・実施入力データセット・予約枠はいずれも持たない。
  # 輸血に「伝票から項目を選ぶ」作法は無く、製剤の一覧から選ぶだけで足りる。
  def change
    create_table :master_transfusion_products do |t|
      t.string :item_code, null: false # 独自採番。ISBT128 の製品コード手入力も可
      t.string :name, null: false      # 赤血球液-LR「日赤」2単位 など
      t.string :name_kana              # カナ名称。検索用の入力元
      t.string :abbreviation           # RBC-LR など。一覧・カードの狭い場所で使う

      # 製剤区分。部門一覧の絞り込み軸。
      # rbc = 赤血球 / ffp = 血漿 / plt = 血小板 / auto = 自己血 / other = その他
      t.string :category, null: false, default: "rbc"

      # 単位の呼び方。赤血球・血漿・血小板は「単位」、自己血は「mL」もある。
      t.string :unit_label, null: false, default: "単位"
      # オーダー画面の単位数の初期値(赤血球なら 2 など)。
      t.integer :default_units

      # 交差適合試験(クロスマッチ)が要る製剤か。血漿・血小板は不要が既定なので、
      # オーダー画面の検査区分の初期選択に使う。
      t.boolean :requires_crossmatch, null: false, default: true

      t.date :valid_from               # 有効開始日
      t.date :valid_to                 # 有効終了日。期限を過ぎた製剤は選択肢に出さない
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_transfusion_products, :item_code, unique: true
    add_index :master_transfusion_products, :category
  end
end
