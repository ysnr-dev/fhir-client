class MergeFacilitySettingsIntoSettingsColumn < ActiveRecord::Migration[8.0]
  # 施設設定を settings(jsonb)1 列に集約する。項目ごとの列は backend では検索にも
  # 集計にも使っておらず(読むのは frontend だけ)、項目を足すたびに migration が
  # 要るだけだったため。以後の項目は項目表(FacilitySettings::SETTINGS)に足す。
  #
  # 単一行のテーブルなので移行は UPDATE 1 行。未設定({})の項目は移さない。
  COLUMNS = %w[
    nursing_schedule
    meal_schedule
    vital_thresholds
    water_balance
    medication_schedule
    document_reminder
  ].freeze

  def up
    add_column :facility_settings, :settings, :jsonb, null: false, default: {}

    pairs = COLUMNS.map { |column| "'#{column}', #{column}" }.join(", ")
    execute(<<~SQL.squish)
      UPDATE facility_settings
         SET settings = (
               SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
                 FROM jsonb_each(jsonb_build_object(#{pairs}))
                WHERE value <> '{}'::jsonb
             )
    SQL

    COLUMNS.each { |column| remove_column :facility_settings, column }
  end

  def down
    COLUMNS.each { |column| add_column :facility_settings, column, :jsonb, null: false, default: {} }

    assignments = COLUMNS.map { |column| "#{column} = COALESCE(settings -> '#{column}', '{}'::jsonb)" }.join(", ")
    execute("UPDATE facility_settings SET #{assignments}")

    remove_column :facility_settings, :settings
  end
end
