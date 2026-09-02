class AddVitalThresholdsToFacilitySettings < ActiveRecord::Migration[8.0]
  # 経過表でバイタルを異常値として強調するしきい値。施設ごとの業務設定なので、看護指示の
  # 既定時刻・食事の提供時刻と同じ単一行に持つ。形は jsonb 1 列
  # (FacilitySettings::DEFAULT_VITAL_THRESHOLDS。LOINC コード → { low, high })。
  # 判定は表示時に行い、Observation には書かない(しきい値を変えれば過去の測定にも効く)。
  def change
    add_column :facility_settings, :vital_thresholds, :jsonb, null: false, default: {}
  end
end
