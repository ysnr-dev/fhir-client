class AddWaterBalanceToFacilitySettings < ActiveRecord::Migration[8.0]
  # 経過表の水分出納(In/Out)に数える看護観察の項目。MEDIS の管理番号を in / out の
  # 配列で持つ。どの項目を数えるかは施設の運用(導尿と膀胱瘻を分けるか、ドレーンを
  # どこまで含めるか)で違うので、コードに焼き付けず設定にする。
  # 形は jsonb 1 列(FacilitySettings::DEFAULT_WATER_BALANCE)。
  def change
    add_column :facility_settings, :water_balance, :jsonb, null: false, default: {}
  end
end
