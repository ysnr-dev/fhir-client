class CreateMasterLabSpecimens < ActiveRecord::Migration[8.0]
  # 検体(材料)マスタ。JLAC11 の材料コード一覧(jlac11_1_1.0.xlsx の材料コードシート)
  # から取り込む。略称と既定採取管は配布ファイルに無いため画面から手入力する。
  def change
    create_table :master_lab_specimens do |t|
      t.string :specimen_code, null: false # JLAC11 材料コード3桁(250=血清 など)
      t.string :name, null: false          # 材料名称(字下げを除いた名称)
      t.string :short_name                 # 略称(手入力)
      # 検体分類。配布ファイルのグループ見出し(尿・便 / 血液 など)。
      t.string :category
      # 配布ファイルの字下げ階層の親(100 尿 > 101 自然排尿)。選択UIで畳むために保持。
      t.string :parent_specimen_code
      # 配布ファイルで「推奨コード」印が付いた材料。選択肢の絞り込み・上位表示に使う。
      t.boolean :recommended, null: false, default: false
      # 旧体系(JLAC10)の材料コード。配布ファイルの備考(1)。
      # master_lab_items.jlac10_specimen との突合に使う。
      t.string :jlac10_specimen_code
      # 既定の採取管(master_lab_containers.container_code)。オーダー項目側で
      # 上書きしない限りこの採取管を使う。コードで緩く紐づけ、外部キーは張らない。
      t.string :default_container_code
      # 配布ファイルの掲載順。コード順と一致しない箇所があるため保持する。
      t.integer :display_order
      t.string :name_kana                  # カナ名称。配布ファイルのルビから取り込む
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_lab_specimens, :specimen_code, unique: true
    add_index :master_lab_specimens, :parent_specimen_code
  end
end
