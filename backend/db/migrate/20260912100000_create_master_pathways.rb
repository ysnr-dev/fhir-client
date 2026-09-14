class CreateMasterPathways < ActiveRecord::Migration[8.0]
  # クリニカルパス(施設パス)定義の本体(docs/clinical-pathway-design.md)。
  # ePath の施設パス(PlanDefinition EP02)に対応する。レジメンと同じく施設共通の
  # 承認制マスタで、病日・OAT ユニット・観察項目・タスクは pathway_code で結ぶ
  # 子テーブルに置く(外部キーは張らない)。
  def change
    create_table :master_pathways do |t|
      t.string :pathway_code, null: false
      t.string :name, null: false
      t.string :short_name
      t.string :name_kana
      t.string :version                                   # 版(X.Y)。改訂は複製して新しいコードで行う
      t.string :department_code                           # 診療科(上流 Organization の識別コード)
      t.string :department_name                           # 表示用の非正規化
      t.string :setting, null: false, default: "inpatient" # inpatient / outpatient
      t.integer :scheduled_days                           # パス予定日数
      t.text :adaptive_criteria                           # 適応基準(承認時必須)
      t.string :protocol_base                             # 元にしたひな型パスの URL
      t.string :status, null: false, default: "draft"     # draft / approved / retired
      t.date :approved_on
      t.string :approved_by
      t.date :valid_from
      t.date :valid_to
      t.integer :display_order
      t.text :note
      t.string :copied_from_code                          # 複製元のパスコード(改訂の系列)
      t.string :search_name
      t.string :search_kana
      t.string :search_short_name
      t.timestamps
    end
    add_index :master_pathways, :pathway_code, unique: true
    add_index :master_pathways, :department_code
    add_index :master_pathways, :status
    add_index :master_pathways, :copied_from_code
    %i[search_name search_kana search_short_name].each do |column|
      add_index :master_pathways, column, using: :gin, opclass: :gin_trgm_ops,
                                          name: "idx_master_pathways_#{column}_trgm"
    end
  end
end
