class AddMealScheduleToFacilitySettings < ActiveRecord::Migration[8.0]
  # 食事の提供時刻(朝・昼・夕)。退院・外出泊の日時から「どの食事まで出すか / どの食事から
  # 戻すか」を決めるのに使う施設ごとの業務設定なので、看護指示の既定時刻と同じ単一行に持つ。
  # 形は jsonb 1 列(FacilitySettings::DEFAULT_MEAL_SCHEDULE)。欠けたキーは model 側で埋める。
  def change
    add_column :facility_settings, :meal_schedule, :jsonb, null: false, default: {}
  end
end
