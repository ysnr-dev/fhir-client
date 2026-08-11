class CreateMasterMicroOrganisms < ActiveRecord::Migration[8.0]
  # 細菌検査オーダーの目的菌。JANIS 検査部門の感染症病原体(菌名)コード表を取り込む。
  # 550件超あるため、オーダー画面に直接並べる頻用菌を frequent フラグで選ぶ
  # (取込では上書きせず温存する)。施設追加は source=local。
  def change
    create_table :master_micro_organisms do |t|
      t.string :code, null: false        # JANIS 病原体コード(4桁)
      t.string :name, null: false        # 菌名(概ね学名。一部に和名・注記つき)
      t.boolean :frequent, null: false, default: false # オーダー画面に直接表示する頻用菌
      t.string :source, null: false, default: "official" # official | local
      t.integer :display_order           # コード表の掲載順

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name

      t.timestamps
    end

    add_index :master_micro_organisms, :code, unique: true
    add_index :master_micro_organisms, :search_name
  end
end
