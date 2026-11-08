class AddStorageToSsmix2Messages < ActiveRecord::Migration[8.0]
  # 拡張ストレージ(docs/ssmix2-export-design.md §12)のメッセージ。storage が extended の行は body が主文書
  # (HL7 CDA R2、UTF-8)で、document_folder がデータ種別フォルダ名、files が主文書以外のファイル。
  def change
    add_column :ssmix2_messages, :storage, :string, null: false, default: "standard"
    add_column :ssmix2_messages, :document_folder, :string
    add_column :ssmix2_messages, :document_name, :string
    add_column :ssmix2_messages, :files, :jsonb, null: false, default: []
  end
end
