class AddDocumentsToMasterManagementFeeItems < ActiveRecord::Migration[8.0]
  # 算定の要件になる文書(docs/medical-management-order-design.md §6)。
  def change
    # 文書テンプレートの code(document_templates.code)の配列。どれか 1 つがあれば足りる。
    add_column :master_management_fee_items, :document_template_codes, :jsonb, null: false, default: []
    # 文書の有効月数。算定月を含め過去この月数の文書で足りる。空なら算定日当日の文書が要る。
    add_column :master_management_fee_items, :document_interval_months, :integer
  end
end
