class CreateMasterLabContainers < ActiveRecord::Migration[8.0]
  # 採取管(採血管・採尿容器など)のマスタ。容器の呼称・キャップ色は
  # メーカーや施設で変わるため定数ではなくマスタで持つ。
  def change
    create_table :master_lab_containers do |t|
      t.string :container_code, null: false
      t.string :name, null: false       # 採取管名称(EDTA-2K採血管 など)
      t.string :short_name              # 略称(EDTA管 など)
      # キャップ色(紫 など)。採血現場では色が実質的な識別子になる。
      t.string :cap_color
      # 添加剤・抗凝固剤(EDTA-2K / ヘパリンNa / フッ化Na / クエン酸Na / なし など)。
      # 名称に埋め込まず列で持つことで検索・検証に使える。
      t.string :additive
      t.string :capacity                # 容量(5mL など)。採血量の指示に使う
      t.integer :display_order
      t.text :note

      t.timestamps
    end

    add_index :master_lab_containers, :container_code, unique: true
  end
end
