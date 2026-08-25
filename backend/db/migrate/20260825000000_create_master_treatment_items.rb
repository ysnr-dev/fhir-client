class CreateMasterTreatmentItems < ActiveRecord::Migration[8.0]
  # 処置オーダー項目マスタ。医師がオーダー画面で選ぶ単位の処置で、画面から手動で
  # 登録・メンテナンスする。生理検査の master_physio_items にあたる。
  # セットの構成は master_treatment_set_items が持つ。
  #
  # 生理検査との違いは分類軸(検査種別)を持たないこと。処置は「創傷処置」「留置
  # カテーテル設置」のように項目名そのものが内容を表し、検査室・装置のような
  # 部門内の分類軸が無いので、施設定義の種別マスタを作らない。
  # 検査目的・特別指示の既定テンプレートも持たない(オーダー画面に両欄が無い)。
  def change
    create_table :master_treatment_items do |t|
      t.string :item_code, null: false # 独自採番の項目コード
      t.string :name, null: false      # 項目名称(創傷処置・胃管挿入 など)
      t.string :short_name             # 略称
      t.string :name_kana              # カナ名称。検索用の入力元
      # single = 単項目 / set = 複数の単項目をまとめて依頼するもの。
      t.string :kind, null: false, default: "single"

      t.date :valid_from               # 有効開始日
      t.date :valid_to                 # 有効終了日。期限を過ぎた項目は選択肢に出さない
      t.string :receipt_code           # レセ電算 診療行為コード。会計連携用
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_short_name
      t.string :search_kana

      # 他の処置項目と同じオーダーにまとめられるか。false の項目は 1 件で
      # 1 オーダーになる(処置室の枠を 1 件ずつ押さえる必要がある処置)。
      t.boolean :groupable, null: false, default: true
      # 実施入力の初期明細になるデータセット(master_treatment_datasets.dataset_code)。
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

    add_index :master_treatment_items, :item_code, unique: true
    add_index :master_treatment_items, :kind
    add_index :master_treatment_items, :groupable
    add_index :master_treatment_items, :dataset_code

    # セット(1オーダー → 複数の処置)の構成。master_treatment_items.item_code で
    # 緩く紐づける(外部キーは張らない)。
    create_table :master_treatment_set_items do |t|
      t.string :set_item_code, null: false
      t.string :member_item_code, null: false
      t.integer :display_order
      t.text :note

      t.timestamps
    end

    add_index :master_treatment_set_items, %i[set_item_code member_item_code],
              unique: true, name: "index_treatment_set_items_on_set_and_member"
    add_index :master_treatment_set_items, :member_item_code
  end
end
