class CreateMasterLabReferenceRanges < ActiveRecord::Migration[8.0]
  # 検体検査の結果項目(master_lab_result_items)の基準値。数値型(PQ)の結果項目に対して、
  # 性別・年齢帯ごとに下限・上限を持つ(1 結果項目 : N 行)。結果登録時に該当する行を
  # Observation.referenceRange に写し、値と突き合わせて H/L を自動判定する。
  # 施設の測定系で決まる値なので、配布マスタではなく施設マスタ側に置く。
  def change
    create_table :master_lab_reference_ranges do |t|
      t.string :result_item_code, null: false # master_lab_result_items.result_item_code(FK は張らない)
      # 性別。NULL = 共通 / male / female
      t.string :sex
      # 適用する年齢(満年齢、歳)。NULL は開区間(age_from が NULL なら 0 歳から、age_to が NULL なら上限なし)
      t.integer :age_from
      t.integer :age_to
      t.decimal :lower_limit, precision: 12, scale: 3
      t.decimal :upper_limit, precision: 12, scale: 3
      t.integer :display_order
      t.text :note

      t.timestamps
    end

    add_index :master_lab_reference_ranges, :result_item_code
  end
end
