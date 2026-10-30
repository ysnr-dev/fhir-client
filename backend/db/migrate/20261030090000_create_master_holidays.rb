require "csv"

class CreateMasterHolidays < ActiveRecord::Migration[8.0]
  # 祝日・休診日マスタ(docs/features/master-data.md「祝日・休診日」)。
  # 国民の祝日は内閣府の配布 CSV を UTF-8 にした db/seed_data/holidays.csv を入れておく
  # (本番は seed を流せないので migration で入れる)。翌年分以降は取込画面から足す。
  def up
    create_table :master_holidays do |t|
      t.date :holiday_date, null: false
      t.string :name, null: false
      # national = 国民の祝日(配布 CSV の取込で入れ替わる)/ facility = 施設の休診日(画面から登録)
      t.string :kind, null: false, default: "national"
      t.timestamps
    end
    add_index :master_holidays, :holiday_date, unique: true

    path = Rails.root.join("db/seed_data/holidays.csv")
    return unless File.exist?(path)

    now = Time.current
    rows = CSV.foreach(path, headers: true).map do |row|
      { holiday_date: row["date"], name: row["name"], kind: "national", created_at: now, updated_at: now }
    end
    table = Class.new(ActiveRecord::Base) { self.table_name = "master_holidays" }
    rows.each_slice(500) { |slice| table.insert_all(slice) }
  end

  def down
    drop_table :master_holidays
  end
end
