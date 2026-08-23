class CreateMasterPhysioItems < ActiveRecord::Migration[8.0]
  # 生理検査オーダー項目マスタ。医師がオーダー画面で選ぶ単位の検査項目で、
  # 画面から手動で登録・メンテナンスする。放射線の master_rad_items にあたる。
  # セットの構成は master_physio_set_items が持つ。
  #
  # 放射線との違いは JJ1017 を持たないこと。生理検査は JJ1017 に収載されて
  # いないため、32桁コードとその11要素の列は無く、代わりに施設が定義する
  # 検査種別(master_physio_exam_types)をコードで緩く参照する。
  def change
    create_table :master_physio_items do |t|
      t.string :item_code, null: false # 独自採番の項目コード
      t.string :name, null: false      # 項目名称(心電図12誘導・腹部超音波 など)
      t.string :short_name             # 略称
      t.string :name_kana              # カナ名称。検索用の入力元
      # single = 単項目 / set = 複数の単項目をまとめて依頼するもの。
      t.string :kind, null: false, default: "single"

      # 検査種別(master_physio_exam_types.exam_type_code)。外部キーは張らない。
      # 未分類の項目もありうるので NULL 可。
      t.string :exam_type_code

      t.date :valid_from               # 有効開始日
      t.date :valid_to                 # 有効終了日。期限を過ぎた項目は選択肢に出さない
      t.string :receipt_code           # レセ電算 診療行為コード。会計連携用
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_short_name
      t.string :search_kana

      # オーダー画面の検査目的・特別指示を記入するテンプレート(Questionnaire)の
      # canonical。項目ごとの既定で、オーダー時に別のテンプレートも選べる。
      t.string :purpose_template_canonical
      t.string :remarks_template_canonical

      # 他の検査項目と同じオーダーにまとめられるか。false の項目は 1 件で
      # 1 オーダーになる(検査室の枠を 1 件ずつ押さえる必要がある検査)。
      t.boolean :groupable, null: false, default: true
      # 実施入力の初期明細になるデータセット(master_physio_datasets.dataset_code)。
      t.string :dataset_code
      # 実施入力をする項目か。false なら部門一覧の「実施」で実施記録を作らずに
      # Task を完了するだけにする。
      t.boolean :requires_perform_input, null: false, default: true
      # 予約枠を押さえてからでないとオーダーできない項目か。
      t.boolean :requires_appointment, null: false, default: false
      t.integer :duration_minutes         # 予約枠の所要時間(分)
      t.string :appointment_schedule_id   # 予約枠(FHIR Schedule)の id

      t.timestamps
    end

    add_index :master_physio_items, :item_code, unique: true
    add_index :master_physio_items, :kind
    add_index :master_physio_items, :exam_type_code
    add_index :master_physio_items, :groupable
    add_index :master_physio_items, :dataset_code

    # セット(1オーダー → 複数の検査)の構成。master_physio_items.item_code で
    # 緩く紐づける(外部キーは張らない)。
    create_table :master_physio_set_items do |t|
      t.string :set_item_code, null: false
      t.string :member_item_code, null: false
      t.integer :display_order
      t.text :note

      t.timestamps
    end

    add_index :master_physio_set_items, %i[set_item_code member_item_code],
              unique: true, name: "index_physio_set_items_on_set_and_member"
    add_index :master_physio_set_items, :member_item_code
  end
end
