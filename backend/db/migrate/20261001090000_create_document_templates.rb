class CreateDocumentTemplates < ActiveRecord::Migration[8.0]
  def change
    create_table :document_templates do |t|
      # 作成した文書の DocumentReference.type の coding.code から参照される不変のコード。
      # 環境をまたいでも衝突しないよう連番ではなく UUID を採番する。
      t.string :code, null: false
      t.string :name, null: false
      # 作成した文書を入れるファイルカテゴリ。カテゴリが消えたら未分類に戻す。
      t.references :file_category, foreign_key: { on_delete: :nullify }
      t.string :file_name, null: false
      t.string :content_type, null: false
      # .docx / .xlsx の本体。数 MB までなので DB に持つ(Active Storage は DICOM 専用)。
      t.binary :data, null: false
      t.integer :byte_size, null: false
      t.integer :display_order, null: false, default: 0
      t.boolean :active, null: false, default: true

      t.timestamps
    end

    add_index :document_templates, :code, unique: true
    add_index :document_templates, :name, unique: true
  end
end
