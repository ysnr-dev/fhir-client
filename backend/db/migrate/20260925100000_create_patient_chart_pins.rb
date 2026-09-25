class CreatePatientChartPins < ActiveRecord::Migration[8.0]
  # 患者ごとにマルチチャートで最初に開くチャート(ピン留め)。患者につき 1 つで、利用者の
  # 間で共有する。チャート定義と同じく上流 FHIR には置かず backend に持つ。
  # patient_id は上流の Patient.id。外部キーは張らない(他マスタと同じ方針。定義を消したときの
  # 後始末は ChartDefinition の dependent で行う)。
  def change
    create_table :patient_chart_pins do |t|
      t.string :patient_id, null: false
      t.bigint :chart_definition_id, null: false
      t.string :pinned_by_id    # ピン留めした Practitioner.id
      t.string :pinned_by_name  # 表示用(上流を引き直さない)
      t.timestamps
    end
    add_index :patient_chart_pins, :patient_id, unique: true
    add_index :patient_chart_pins, :chart_definition_id
  end
end
