class CreateMasterDpcStem7Codes < ActiveRecord::Migration[8.0]
  def change
    create_table :master_dpc_stem7_codes do |t|
      # 様式1 の点数表コードの書き方(空白なし・細目は半角カナ。K0821ｲ、K082-21)。
      t.string :k_code, null: false
      # 配布ファイルの表記そのまま(K082 1 ｲ)。
      t.string :k_code_source, null: false
      t.string :surgery_name
      # 外保連手術試案の手術基幹コード。空白を詰めた 7 桁。
      t.string :stem7, null: false
      # 1 つの K コードに複数の STEM7 があるときの使い分け(配布ファイルの「注意点」)。
      t.string :note
      t.integer :display_order, null: false
      t.timestamps
    end
    add_index :master_dpc_stem7_codes, :k_code
  end
end
