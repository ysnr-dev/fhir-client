class CreateMasterMicroAntimicrobials < ActiveRecord::Migration[8.0]
  # 細菌検査結果の薬剤感受性で使う抗菌薬。JANIS 検査部門の抗菌薬コード表を取り込む。
  # 250件超あるため、結果画面に直接並べる頻用薬を frequent フラグで選ぶ
  # (取込では上書きせず温存する)。施設追加は source=local。
  # category は配布ファイルの系統見出し(ペニシリン系など)で、画面のグルーピングに使う。
  def change
    create_table :master_micro_antimicrobials do |t|
      t.string :code, null: false        # JANIS 抗菌薬コード(4桁)
      t.string :name, null: false        # 和名
      t.string :abbreviation             # 略号(ABPC など)
      t.string :brand_name               # 商品名(参考情報)
      t.string :category                 # 系統名(コード表の見出し行由来)
      t.boolean :frequent, null: false, default: false # 結果画面に直接表示する頻用薬
      t.string :source, null: false, default: "official" # official | local
      t.integer :display_order           # コード表の掲載順

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_abbreviation

      t.timestamps
    end

    add_index :master_micro_antimicrobials, :code, unique: true
    add_index :master_micro_antimicrobials, :search_name
    add_index :master_micro_antimicrobials, :search_abbreviation
  end
end
