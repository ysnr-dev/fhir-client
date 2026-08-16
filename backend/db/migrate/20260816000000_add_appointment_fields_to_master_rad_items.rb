class AddAppointmentFieldsToMasterRadItems < ActiveRecord::Migration[8.0]
  def change
    # 既存項目の挙動を変えないため、予約必須の既定は false。
    add_column :master_rad_items, :requires_appointment, :boolean, null: false, default: false
    # 所要時間(分)。未設定は「1 枠ぶん」として扱うので null を許す。
    add_column :master_rad_items, :duration_minutes, :integer
  end
end
