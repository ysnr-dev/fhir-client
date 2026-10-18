class AddClientIdToCdsServices < ActiveRecord::Migration[8.0]
  # 上流に登録した委任クライアント(CDS サービス用の OAuth クライアント)。あれば hook を呼ぶたびに
  # 短命トークンを発行して fhirAuthorization で渡す(docs/cds-hooks-design.md §2.6)。
  def change
    add_column :cds_services, :client_id, :string
  end
end
