class AddMappingToReportLayouts < ActiveRecord::Migration[8.0]
  def change
    # linkId とレイアウトのアイテム ID の対応を明示するマッピング定義(JSON テキスト)。
    # 空文字は「マッピングなし」を表し、従来どおり ItemIdMapper の命名規約で対応する。
    add_column :report_layouts, :mapping, :text, null: false, default: ""
  end
end
