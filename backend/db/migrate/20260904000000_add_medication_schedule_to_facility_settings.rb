class AddMedicationScheduleToFacilitySettings < ActiveRecord::Migration[8.0]
  # 内服の与薬の予定時刻を出すための設定。処方は「1 日 3 回・食後」までしか持たず、
  # 何時に飲ませるかはどこにも無いので、食事の時刻(meal_schedule)からのずらしと、
  # 就寝前・起床時の時刻をここで持つ。経過表の内服欄が予定の印を置くのに使う。
  def change
    add_column :facility_settings, :medication_schedule, :jsonb, null: false, default: {}
  end
end
