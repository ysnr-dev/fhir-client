class CreateMasterFormularyGroups < ActiveRecord::Migration[8.0]
  def change
    # 院内フォーミュラリの薬効群(PPI・スタチンなど)。施設で 1 本、薬事委員会が決める
    # 参照表なので個人・診療科のスコープは持たない(docs/formulary-design.md)。
    create_table :master_formulary_groups do |t|
      t.string :code, null: false
      t.string :name, null: false
      # この群が受け持つ薬効分類番号(YJ コード上 4 桁)。マスタ画面で群の範囲を示す。
      t.string :yakko_codes, array: true, null: false, default: []
      # 群の剤形区分(1:内用 4:注射 6:外用)。注射オーダーで注射薬の群だけ出す絞り込み用。
      t.string :dosage_form
      t.integer :display_order
      t.text :note

      t.timestamps
    end

    add_index :master_formulary_groups, :code, unique: true
    add_index :master_formulary_groups, :yakko_codes, using: :gin

    create_table :master_formulary_entries do |t|
      t.references :formulary_group, null: false,
                                     foreign_key: { to_table: :master_formulary_groups, on_delete: :cascade }
      # master_medicines.medicine_code(レセプト電算コード)。医薬品マスタは取込のたびに
      # delete_all + 再挿入されて id が変わるため、id ではなくコードで緩く紐づける。
      t.string :medicine_code, null: false
      # 推奨順位。1 が第一選択。
      t.integer :rank, null: false
      # 推奨理由・使い分け。
      t.text :note

      t.timestamps
    end

    add_index :master_formulary_entries, %i[formulary_group_id medicine_code], unique: true
    add_index :master_formulary_entries, :medicine_code
  end
end
