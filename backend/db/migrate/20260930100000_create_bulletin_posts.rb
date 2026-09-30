class CreateBulletinPosts < ActiveRecord::Migration[8.0]
  # 掲示板の投稿(院内のお知らせ)。患者に紐付かない施設内の連絡なので上流 FHIR には
  # 置かず backend に持つ。投稿者は上流の Practitioner.id と表示名を焼き付ける
  # (patient_chart_pins と同じ。administrator は Practitioner を持たないので NULL)。
  def change
    create_table :bulletin_posts do |t|
      t.string :title, null: false
      t.text :body, null: false, default: ""
      t.boolean :pinned, null: false, default: false   # 一覧の先頭に固定する
      t.date :published_from, null: false              # 掲載開始日(省略時は投稿日)
      t.date :published_until                          # 掲載終了日(NULL は無期限)
      t.string :author_id                              # 投稿した Practitioner.id
      t.string :author_name                            # 表示用(上流を引き直さない)
      t.timestamps
    end
    add_index :bulletin_posts, %i[pinned published_from]
    add_index :bulletin_posts, :published_until
  end
end
