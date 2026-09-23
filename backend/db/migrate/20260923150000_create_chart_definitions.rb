class CreateChartDefinitions < ActiveRecord::Migration[8.0]
  # チャート(患者の数値の推移と治療イベントを重ねて読む画面)の定義。
  # 患者を持たない雛形(どの項目を並べるかだけ)なので上流 FHIR には置かず backend に持つ。
  # 持ち主は order_sets と同じ 3 段階(院内共通 / 診療科 / 医師)。
  # definition は jsonb で、形は ChartDefinition#definition_shape が守る。
  # 外部キーは張らない(他マスタと同じ方針)。
  def change
    create_table :chart_definitions do |t|
      t.string :code, null: false      # uuid。複製と環境間の移送に使う
      t.string :scope, null: false     # "facility" | "department" | "practitioner"
      t.string :owner_id               # 診療科 Organization.id / Practitioner.id。facility は NULL
      t.string :owner_name             # 表示用(上流を引き直さない)
      t.string :name, null: false
      t.jsonb :definition, null: false, default: {}
      t.integer :display_order
      t.boolean :active, null: false, default: true
      t.timestamps
    end
    add_index :chart_definitions, :code, unique: true
    add_index :chart_definitions, %i[scope owner_id]
  end
end
