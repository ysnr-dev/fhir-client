class CreateMasterSurgeryRoomBlocks < ActiveRecord::Migration[8.0]
  # 手術室のブロックスケジュール(曜日ごとの科割り当て。「月曜の OR1 午前は外科」)。
  #
  # 手術は予約枠(Schedule / Slot)を持たない設計(docs/surgery-order-design.md §1)
  # なので、この割り当ても FHIR の Schedule では持たない。予約が紐付かない純粋な
  # 施設設定で、読むのは手術室カレンダーと申込フォームの警告だけだから、
  # 他のマスタと同じ backend のテーブルに置く。
  #
  # 割り当ては**警告にしか使わない**。割当外の科でも登録は止めない
  # (割当科が使わない枠を前日に他科へ回す運用が、データを触らずに回るようにする)。
  def change
    create_table :master_surgery_room_blocks do |t|
      # 手術室。FHIR Location(種別 SU)の id を持つ。FHIR リソースは上流にあり
      # DB を跨げないので FK は張らない(他マスタのコード参照と同じ扱い)。
      t.string :location_id, null: false
      t.string :location_name  # 表示用の写し。Location が消えても行の意味が読める

      t.integer :weekday, null: false # 0=日 … 6=土(SlotPattern・Date#wday と同じ並び)
      t.string :start_time, null: false # "09:00"
      t.string :end_time, null: false   # "12:00"

      # 診療科。SS-MIX2 統一診療科コードと名称の写し(Schedule.specialty と同じ持ち方)。
      t.string :department_code, null: false
      t.string :department_name

      t.date :valid_from
      t.date :valid_to
      t.text :note

      t.timestamps
    end

    add_index :master_surgery_room_blocks, %i[location_id weekday]
  end
end
