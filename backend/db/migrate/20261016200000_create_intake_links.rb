class CreateIntakeLinks < ActiveRecord::Migration[8.0]
  # Web 問診(docs/web-intake-design.md)。予約・受付から発行した問診のリンクと、患者が入れた回答。
  # 回答は職員が取り込むまで上流 FHIR に書かず、ここに留める(未確定の回答をカルテに混ぜないため)。
  # 現場の作業キューなので master_ を付けない。外部キーは張らない(他と同じ方針)。
  def change
    create_table :intake_links do |t|
      t.string :token_digest, null: false                 # リンクのトークンの SHA-256。生のトークンは持たない
      t.string :appointment_fhir_id                        # 起点の予約。無ければ患者だけ
      t.string :patient_fhir_id, null: false
      t.jsonb :questionnaire_urls, null: false, default: [] # 答えてもらう質問票(canonical)
      t.string :birth_date                                 # 照合用。暗号化して持つ
      t.datetime :expires_at, null: false
      t.datetime :verified_at                              # 生年月日の照合に通った時刻
      t.integer :failed_attempts, null: false, default: 0
      t.datetime :revoked_at                               # 発行し直して無効にした時刻
      t.string :created_by_id                              # 発行した職員(Practitioner の id)
      t.string :created_by_name
      t.timestamps
    end
    add_index :intake_links, :token_digest, unique: true
    add_index :intake_links, :appointment_fhir_id
    add_index :intake_links, :patient_fhir_id

    create_table :intake_responses do |t|
      t.bigint :intake_link_id, null: false
      t.string :questionnaire_url, null: false
      t.string :questionnaire_version
      t.jsonb :answers, null: false, default: []           # QuestionnaireResponse.item の配列
      t.datetime :submitted_at, null: false
      t.string :status, null: false, default: "pending"    # pending / imported / discarded
      t.string :imported_qr_id                             # 取り込んだ QuestionnaireResponse の id
      t.string :imported_by_id
      t.timestamps
    end
    add_index :intake_responses, %i[intake_link_id questionnaire_url], name: "index_intake_responses_on_link_and_url"
    add_index :intake_responses, :status
  end
end
