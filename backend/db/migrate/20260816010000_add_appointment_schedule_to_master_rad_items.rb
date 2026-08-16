class AddAppointmentScheduleToMasterRadItems < ActiveRecord::Migration[8.0]
  def change
    # 予約必須の項目が予約を取る先の枠表(FHIR Schedule の id)。マスタは FHIR と
    # 別ストアなので文字列で参照し、枠表側が消えていても壊れない(画面側で
    # 通常の枠表選択にフォールバックする)。
    add_column :master_rad_items, :appointment_schedule_id, :string
  end
end
