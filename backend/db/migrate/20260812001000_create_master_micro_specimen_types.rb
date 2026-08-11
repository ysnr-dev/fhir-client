class CreateMasterMicroSpecimenTypes < ActiveRecord::Migration[8.0]
  # 細菌検査オーダーの検体種別。JANIS 検査部門の材料(検査材料)コード表を取り込む。
  # JANIS に無い材料を施設で足せるよう、source=local の行を同居させる
  # (JJ1017 部品コードと同じ方式。取込は official のみ入れ替える)。
  def change
    create_table :master_micro_specimen_types do |t|
      t.string :code, null: false        # JANIS 材料コード(3桁)
      t.string :name, null: false        # 検査材料名
      t.string :category                 # 系統(口腔・気道・呼吸器 / 泌尿器・生殖器 など)
      t.string :source, null: false, default: "official" # official | local
      t.integer :display_order           # コード表の掲載順

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name

      t.timestamps
    end

    add_index :master_micro_specimen_types, :code, unique: true
    add_index :master_micro_specimen_types, :search_name
  end
end
