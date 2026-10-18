class CreateCdsServices < ActiveRecord::Migration[8.0]
  # CDS Hooks のサービス提供元(docs/cds-hooks-design.md)。1 行が 1 つの base URL で、
  # 配下のサービス一覧は discovery(GET /cds-services)で読む。
  def change
    create_table :cds_services do |t|
      t.string :name, null: false
      t.string :base_url, null: false
      t.string :auth_token
      t.boolean :enabled, null: false, default: true
      t.integer :position, null: false, default: 0
      t.timestamps
    end
  end
end
