class CreateMasterRegimenAdverseEvents < ActiveRecord::Migration[8.0]
  # レジメンで想定する副作用。用語は CTCAE の用語を自由記述で持つ
  # (用語マスタの取込は後続)。grade は注意すべき Grade(1〜5)。
  def change
    create_table :master_regimen_adverse_events do |t|
      t.string :regimen_code, null: false
      t.integer :display_order
      t.string :term, null: false
      t.integer :grade
      t.text :note                               # 対処
      t.timestamps
    end
    add_index :master_regimen_adverse_events, :regimen_code
  end
end
