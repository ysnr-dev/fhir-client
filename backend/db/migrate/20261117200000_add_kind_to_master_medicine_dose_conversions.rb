class AddKindToMasterMedicineDoseConversions < ActiveRecord::Migration[8.0]
  def up
    # 入力単位の種類。potency(力価) / volume(容量 mL) / package(包装単位。枚・本など) /
    # identity(薬価算定単位そのもの)。
    add_column :master_medicine_dose_conversions, :kind, :string

    execute <<~SQL.squish
      UPDATE master_medicine_dose_conversions
      SET kind = CASE
        WHEN normalize(btrim(from_unit), NFKC) = normalize(btrim(to_unit), NFKC) THEN 'identity'
        WHEN lower(normalize(btrim(from_unit), NFKC)) = 'ml' THEN 'volume'
        ELSE 'potency'
      END
    SQL

    change_column_null :master_medicine_dose_conversions, :kind, false
    add_index :master_medicine_dose_conversions, %i[medicine_code kind],
              name: "index_medicine_dose_conversions_on_code_and_kind"

    # 包装単位は 1 枚 = 7 g のように割り切れない係数(1/7)になるので、桁を広げる。
    change_column :master_medicine_dose_conversions, :factor, :decimal, precision: 20, scale: 10, null: false
  end

  def down
    change_column :master_medicine_dose_conversions, :factor, :decimal, precision: 16, scale: 6, null: false
    remove_index :master_medicine_dose_conversions, name: "index_medicine_dose_conversions_on_code_and_kind"
    remove_column :master_medicine_dose_conversions, :kind
  end
end
