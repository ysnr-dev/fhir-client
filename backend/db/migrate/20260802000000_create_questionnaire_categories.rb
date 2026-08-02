class CreateQuestionnaireCategories < ActiveRecord::Migration[8.0]
  def change
    create_table :questionnaire_categories do |t|
      # Questionnaire 側の拡張から参照される不変のコード。テンプレートを別環境へ
      # エクスポート/インポートしても衝突しないよう連番ではなく UUID を採番する。
      t.string :code, null: false
      t.string :name, null: false
      # プルダウンでの並び順。同値は id 順(登録順)で安定させる。
      t.integer :display_order, null: false, default: 0

      t.timestamps
    end

    add_index :questionnaire_categories, :code, unique: true
    add_index :questionnaire_categories, :name, unique: true
  end
end
