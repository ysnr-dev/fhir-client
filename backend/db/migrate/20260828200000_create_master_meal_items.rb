class CreateMasterMealItems < ActiveRecord::Migration[8.0]
  # 食事オーダー項目マスタ。食種(一般食・糖尿病食・食止め など)と主食(米飯・粥・
  # パン など)を 1 テーブルに入れ、kind 列で分ける。列構成が同じで、FHIR 側は
  # CodeSystem の URI(meal-type / meal-staple-food)で既に区別しているため。
  #
  # SS-MIX2 の給食オーダ(OMD^O03)の ODS セグメントでいう ODS-1=T(食種、食止めを
  # 含む)と ODS-1=D(主食)にあたる。嗜好品(P)・補助食(S)は今回扱わない。
  #
  # 処置(master_treatment_items)との違いは、セット・伝票レイアウト・実施入力
  # データセット・予約枠を一切持たないこと。食事はオーダー 1 件が食種 1 つを
  # 指すだけで、明細も部門実施入力も無い。
  def change
    create_table :master_meal_items do |t|
      t.string :item_code, null: false # 独自採番の項目コード。NPO などの手入力も可
      t.string :name, null: false      # 一般食2000kcal・米飯180g・食止め など
      t.string :name_kana              # カナ名称。検索用の入力元
      # diet = 食種(ODS-1=T) / staple = 主食(ODS-1=D)。
      t.string :kind, null: false, default: "diet"
      # 食止め(禁食)の食種か。オーダー画面で主食欄を無効にするために使う。
      # SS-MIX2 は食止めを食種の 1 コード(NPO)として扱うので、こちらも食種の
      # 一種として持ち、オーダー側に「食止めフラグ」は作らない。
      t.boolean :is_fasting, null: false, default: false

      t.date :valid_from               # 有効開始日
      t.date :valid_to                 # 有効終了日。期限を過ぎた項目は選択肢に出さない
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_meal_items, :item_code, unique: true
    add_index :master_meal_items, :kind
  end
end
