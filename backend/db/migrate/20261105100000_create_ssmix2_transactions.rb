class CreateSsmix2Transactions < ActiveRecord::Migration[8.0]
  # SS-MIX2 標準化ストレージ出力(docs/ssmix2-export-design.md §4)。上流 FHIR へ書けた transaction を
  # そのまま控え、院内エージェントのポーリングで HL7 メッセージに起こす。短期の受け渡し用で、
  # 処理済みの行は 14 日で消す。
  def change
    create_table :ssmix2_transactions do |t|
      t.datetime :occurred_at, precision: 6, null: false
      t.string :actor_practitioner_id
      t.string :method, null: false
      t.string :path, null: false, default: ""
      t.jsonb :request, null: false, default: {}
      t.jsonb :response
      t.string :status, null: false, default: "pending"
      t.text :error
      t.integer :attempts, null: false, default: 0
      t.datetime :leased_at, precision: 6
      t.datetime :processed_at, precision: 6
      t.timestamps
    end
    add_index :ssmix2_transactions, %i[status occurred_at]
  end
end
