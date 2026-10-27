class CreateWaitingBoard < ActiveRecord::Migration[8.0]
  # 待合表示板(docs/waiting-board-design.md)。ロビーのモニターがログイン無しで開くリンクと、
  # 受付番号(当日の連番)のカウンタ。どちらも現場の運用データなので master_ を付けない。外部キーは張らない(他と同じ方針)。
  def change
    create_table :waiting_board_links do |t|
      t.string :token_digest, null: false                  # リンクのトークンの SHA-256。生のトークンは持たない
      t.string :label, null: false                         # 「1 階ロビー」など、置き場所の名前
      t.jsonb :location_ids, null: false, default: []      # 出す診察室(Location の id)。空なら全部
      t.string :created_by_id                              # 発行した職員(Practitioner の id)
      t.string :created_by_name
      t.datetime :revoked_at                               # 取り消した時刻
      t.timestamps
    end
    add_index :waiting_board_links, :token_digest, unique: true

    create_table :reception_number_counters do |t|
      t.date :day, null: false                             # 日本時間の暦日。番号は日ごとに 1 から
      t.integer :last_number, null: false, default: 0
      t.timestamps
    end
    add_index :reception_number_counters, :day, unique: true
  end
end
