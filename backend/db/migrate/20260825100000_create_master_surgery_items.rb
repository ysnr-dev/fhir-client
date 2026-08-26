class CreateMasterSurgeryItems < ActiveRecord::Migration[8.0]
  # 術式マスタ。医師が手術オーダー(申込)画面で選ぶ単位の術式で、画面から手動で
  # 登録・メンテナンスする。処置の master_treatment_items にあたるが、手術は
  # 伝票レイアウト(グリッド)に並べる運用が無く検索で選ぶだけなので、レイアウト・
  # セット・実施入力データセットのテーブルは持たない(実施入力は第2段階)。
  #
  # 既定値列(default_*)は申込フォームの初期値。術式を選んだ時点で所要時間・
  # 到達法・体位・麻酔方法が埋まり、申込時の入力を最小にする。
  def change
    create_table :master_surgery_items do |t|
      t.string :item_code, null: false # 独自採番の項目コード
      t.string :name, null: false      # 術式名称(腹腔鏡下胆嚢摘出術 など)
      t.string :short_name             # 略称
      t.string :name_kana              # カナ名称。検索用の入力元

      t.date :valid_from               # 有効開始日
      t.date :valid_to                 # 有効終了日。期限を過ぎた項目は選択肢に出さない
      t.string :receipt_code           # レセ電算 診療行為コード(K章)。会計・DPC連携用

      t.integer :default_duration_minutes  # 予定所要時間の既定(分)
      t.string :default_approach           # 到達法の既定(surgery-approach のコード)
      t.string :default_position           # 手術体位の既定(surgery-position のコード)
      # 麻酔方法の既定(surgery-anesthesia-method のコード)。複数可なのでカンマ区切り。
      t.string :default_anesthesia_methods

      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_short_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_surgery_items, :item_code, unique: true
  end
end
