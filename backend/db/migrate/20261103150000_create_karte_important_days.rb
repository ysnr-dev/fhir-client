class CreateKarteImportantDays < ActiveRecord::Migration[8.0]
  # カルテの重要日(docs/features/karte.md)。患者と診療日につき 1 つ、利用者の間で共有する。
  def change
    create_table :karte_important_days do |t|
      t.string :patient_id, null: false
      t.date :day, null: false
      t.string :severity, null: false
      t.text :comment
      t.string :set_by_id
      t.string :set_by_name
      t.timestamps
    end
    add_index :karte_important_days, %i[patient_id day], unique: true
  end
end
