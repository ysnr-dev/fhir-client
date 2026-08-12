class AddGroupableToMasterRadItems < ActiveRecord::Migration[8.0]
  # 撮影項目を「他の撮影項目と同じオーダーにまとめられるか」で分ける。
  #   true  … グループ化。従来どおり複数の撮影項目を 1 オーダーにまとめられる
  #   false … 単独。この項目だけで 1 オーダーにする(CT・MRI など 1 撮影に
  #           時間を要し、撮影室の枠を 1 件ずつ押さえる必要がある項目)
  #
  # モダリティ単位ではなく項目単位で持つのは、同じモダリティでも運用で例外を
  # 作れるようにするため。既存の項目はすべて従来どおり(true)。
  def change
    add_column :master_rad_items, :groupable, :boolean, null: false, default: true
    add_index :master_rad_items, :groupable
  end
end
