class CreateMasterMicroOrderMasters < ActiveRecord::Migration[8.0]
  # 細菌検査オーダーの独自マスタ3種。JANIS は結果報告用のコード体系で、
  # 「何を依頼するか(検査項目)」「どこから採るか(採取部位)」「どう採るか(採取方法)」
  # の概念を持たないため、施設マスタとして持つ(seed で初期値を投入し画面で直す)。
  def change
    # 検査項目(塗抹・鏡検 / 培養・同定 / 薬剤感受性 / 抗酸菌塗抹 / 血液培養ボトル など)。
    # 9項目程度の固定的な小マスタなので、検体検査・放射線のようなレイアウト(伝票)
    # 機能は持たず、オーダー画面にチェックボックスを直接並べる。
    create_table :master_micro_order_items do |t|
      t.string :item_code, null: false   # 項目コード(独自採番)
      t.string :name, null: false
      t.string :short_name               # カルテカードなど狭い場所での表示用
      t.integer :display_order
      t.date :valid_from                 # 有効開始日(検体検査・放射線と同じ)
      t.date :valid_to                   # 有効終了日
      t.string :receipt_code             # レセ電算コード(任意、将来の会計連携用)
      t.string :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name

      t.timestamps
    end
    add_index :master_micro_order_items, :item_code, unique: true

    # 採取部位。JANIS 材料コード(検体種別)と別に持つのは、材料が同じでも
    # 採取した場所(創部・耳・眼 など)が培養結果の解釈に要るため。
    create_table :master_micro_collection_sites do |t|
      t.string :code, null: false        # 部位コード(独自採番)
      t.string :name, null: false
      # 左右の入力を有効にするか(耳・眼・関節などは true)。
      t.boolean :laterality_applicable, null: false, default: false
      t.integer :display_order

      t.timestamps
    end
    add_index :master_micro_collection_sites, :code, unique: true

    # 採取方法(スワブ / 穿刺 / 吸引 など)。
    create_table :master_micro_collection_methods do |t|
      t.string :code, null: false        # 方法コード(独自採番)
      t.string :name, null: false
      t.integer :display_order

      t.timestamps
    end
    add_index :master_micro_collection_methods, :code, unique: true
  end
end
