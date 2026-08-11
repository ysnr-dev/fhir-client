class CreateMasterMicroSusceptibilityMethods < ActiveRecord::Migration[8.0]
  # 細菌検査結果の薬剤感受性の検査方法。JANIS 検査部門の薬剤感受性検査測定法
  # コード表を取り込む。30件程度なので頻用フラグは持たず全件を選択肢に出す。
  # 施設追加は source=local。
  def change
    create_table :master_micro_susceptibility_methods do |t|
      t.string :code, null: false         # JANIS 測定法コード(2桁)
      t.string :name, null: false         # 方法(微量液体希釈法など)
      t.string :classification            # 自動化機器 | 用手法(空欄もある)
      t.string :product_name              # 製品名
      t.string :company                   # 発売会社
      t.string :note                      # 備考
      t.string :source, null: false, default: "official" # official | local
      t.integer :display_order            # コード表の掲載順

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name

      t.timestamps
    end

    add_index :master_micro_susceptibility_methods, :code, unique: true
    add_index :master_micro_susceptibility_methods, :search_name
  end
end
