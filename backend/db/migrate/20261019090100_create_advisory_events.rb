class CreateAdvisoryEvents < ActiveRecord::Migration[8.0]
  # 警告の発火と無視の台帳(docs/advisory-design.md §3.2)。フォームのセッションごとに
  # 1 回まとめて書く。(session_id, advisory_key, outcome) の一意制約で再送を吸収する。
  def change
    create_table :advisory_events do |t|
      t.string :session_id, null: false
      t.string :advisory_key, null: false
      t.string :kind, null: false
      t.string :severity, null: false
      t.string :outcome, null: false
      t.string :context, null: false
      t.string :reason_code
      t.text :reason_text
      t.string :practitioner_fhir_id
      t.string :user_login_id
      t.string :order_reference
      t.datetime :occurred_at, null: false
      t.datetime :created_at, null: false
    end
    add_index :advisory_events, %i[kind occurred_at]
    add_index :advisory_events, %i[session_id advisory_key outcome], unique: true,
                                                                       name: "index_advisory_events_on_session_key_outcome"
  end
end
