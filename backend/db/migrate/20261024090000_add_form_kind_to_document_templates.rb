class AddFormKindToDocumentTemplates < ActiveRecord::Migration[8.0]
  def change
    # office: Word / Excel の様式ファイル(本体は data)。
    # form: PDF / 画像の様式にフィールドを置いたもの(本体はページ画像、配置は layout)。
    add_column :document_templates, :kind, :string, null: false, default: "office"
    change_column_null :document_templates, :data, true
    add_column :document_templates, :layout, :jsonb
    # form の回答を保存する先の Questionnaire(自動生成)の canonical。
    add_column :document_templates, :questionnaire_url, :string
    add_column :document_templates, :questionnaire_version, :string

    # form のページ画像。1 ページ 1 行。座標系(px)とページ寸法(pt)をここに持つ。
    create_table :document_template_pages do |t|
      t.references :document_template, null: false, foreign_key: { on_delete: :cascade }
      t.integer :page_number, null: false
      t.string :content_type, null: false
      t.binary :data, null: false
      t.integer :byte_size, null: false
      t.integer :width_px, null: false
      t.integer :height_px, null: false
      t.decimal :width_pt, precision: 8, scale: 2, null: false
      t.decimal :height_pt, precision: 8, scale: 2, null: false

      t.timestamps
    end

    add_index :document_template_pages, %i[document_template_id page_number], unique: true,
              name: "index_document_template_pages_on_template_and_number"
  end
end
