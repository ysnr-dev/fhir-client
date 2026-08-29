class CreateMasterPathoMasters < ActiveRecord::Migration[8.0]
  # 病理検査オーダーのマスタ2種。JAHIS 病理・臨床細胞データ交換規約 Ver.2.1C の
  # 付録-3「病理・臨床細胞オーダ用サンプルマスタ」を初期値として seed で投入する
  # (規約 §5.1.1 が、標準化されたオーダ用マスタが無いためこのサンプルの採用を
  # 勧めている)。
  #
  # 検査区分(組織診/細胞診/術中迅速 = LPATHO001 検査目的群)と検体タイプ
  # (LPATHO002)は数個の固定値なのでフロントの定数に置き、DB マスタにはしない。
  def change
    # 臓器・検査材料(LPATHO003)。8桁コードに ICD-10 が対応する約 530 件の表。
    # 施設固有の材料を足せるよう source=local の行を同居させる(JANIS 材料コードと
    # 同じ方式。取込は official のみ入れ替える)。
    create_table :master_patho_organs do |t|
      t.string :code, null: false        # LPATHO003 の臓器・検査材料コード(8桁)
      t.string :name, null: false
      t.string :icd10                    # 対応する ICD-10 コード(表に併記されている)
      t.string :source, null: false, default: "official" # official | local
      # オーダー画面に直接並べる頻用臓器の印。画面から切り替える(取込では温存)。
      t.boolean :frequent, null: false, default: false
      t.integer :display_order           # コード表の掲載順

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name

      t.timestamps
    end
    add_index :master_patho_organs, :code, unique: true
    add_index :master_patho_organs, :search_name

    # 採取法(LPATHO004)。擦過・穿刺吸引・生検・EMR・ESD・部分切除 など 23 件。
    # 件数が少なく施設で直す前提なので、seed の初期値を画面でメンテする。
    create_table :master_patho_collection_methods do |t|
      t.string :code, null: false        # LPATHO004 の採取法コード(3桁)
      t.string :name, null: false
      t.integer :display_order

      t.timestamps
    end
    add_index :master_patho_collection_methods, :code, unique: true
  end
end
