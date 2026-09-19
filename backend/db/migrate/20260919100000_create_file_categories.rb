class CreateFileCategories < ActiveRecord::Migration[8.0]
  def change
    create_table :file_categories do |t|
      # DocumentReference.category の coding.code から参照される不変のコード。
      # 環境をまたいでも衝突しないよう連番ではなく UUID を採番する。
      t.string :code, null: false
      t.string :name, null: false
      # 選択肢・絞り込みでの並び順。同値は id 順(登録順)で安定させる。
      t.integer :display_order, null: false, default: 0

      t.timestamps
    end

    add_index :file_categories, :code, unique: true
    add_index :file_categories, :name, unique: true
  end
end
