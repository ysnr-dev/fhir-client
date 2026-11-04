class CreateSsmix2Messages < ActiveRecord::Migration[8.0]
  # SS-MIX2 のメッセージ(docs/ssmix2-export-design.md §5.4)と、オーダ No の対応表(§5.1)。
  # body は CP50221 に変換した電文のバイト列。
  def change
    create_table :ssmix2_messages do |t|
      t.references :ssmix2_transaction, foreign_key: { on_delete: :nullify }
      t.string :patient_id, null: false
      t.string :service_date, null: false
      t.string :data_kind, null: false
      t.string :order_no, null: false
      t.string :process, null: false
      t.string :department_code, null: false, default: "-"
      t.string :transaction_at, null: false
      t.binary :body, null: false
      t.text :warnings, array: true, null: false, default: []
      t.string :status, null: false, default: "pending"
      t.datetime :leased_at, precision: 6
      t.integer :attempts, null: false, default: 0
      t.text :error
      t.datetime :written_at, precision: 6
      t.timestamps
    end
    add_index :ssmix2_messages, %i[status id]
    add_index :ssmix2_messages, %i[patient_id service_date data_kind order_no transaction_at],
              unique: true, name: "index_ssmix2_messages_on_file_name"

    create_table :ssmix2_order_numbers do |t|
      t.string :resource_ref, null: false
      t.timestamps
    end
    add_index :ssmix2_order_numbers, :resource_ref, unique: true
  end
end
