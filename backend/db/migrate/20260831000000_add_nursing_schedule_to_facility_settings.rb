class AddNursingScheduleToFacilitySettings < ActiveRecord::Migration[8.0]
  # 看護指示の「1日N回」の既定時刻と「N時間毎」の起点。施設ごとに決まる業務設定なので
  # 自院設定と同じ単一行に持つ。形は jsonb 1 列(FacilitySettings::DEFAULT_NURSING_SCHEDULE)。
  # 欠けたキーは model 側で既定値を埋めて返すので、空 {} のままでも動く。
  def change
    add_column :facility_settings, :nursing_schedule, :jsonb, null: false, default: {}
  end
end
