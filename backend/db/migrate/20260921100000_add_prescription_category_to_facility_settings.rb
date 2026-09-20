class AddPrescriptionCategoryToFacilitySettings < ActiveRecord::Migration[8.0]
  # 処方区分(定期・臨時・院外…)の初期値を入外区分ごとに持つ。処方フォームを開いた
  # ときと入外区分を選び直したときの初期値に使うだけで、登録済みの処方には区分が
  # 焼き付いている(ここを変えても過去の処方は動かない)。
  def change
    add_column :facility_settings, :prescription_category, :jsonb, null: false, default: {}
  end
end
