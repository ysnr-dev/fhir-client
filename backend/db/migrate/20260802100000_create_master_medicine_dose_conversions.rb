class CreateMasterMedicineDoseConversions < ActiveRecord::Migration[8.0]
  def change
    create_table :master_medicine_dose_conversions do |t|
      # master_medicines.medicine_code(レセプト電算コード)。医薬品マスタは取込のたびに
      # delete_all + 再挿入されて id が変わるため、id ではなくコードで緩く紐づける。
      t.string :medicine_code, null: false
      # 処方時に入力する単位。mg / mL / g / ug / 単位 / 国際単位 / MBq / mEq など。
      t.string :from_unit, null: false
      # to_unit 1単位あたりの from_unit 量。入力値 ÷ factor = マスタ単位での数量。
      t.decimal :factor, precision: 16, scale: 6, null: false
      # 換算先。master_medicines.unit_name(薬価算定単位)をそのまま入れる。
      t.string :to_unit, null: false
      # 導出根拠。explicit(規格単位に力価量が明示) / from_percent(濃度%から算出) /
      # volume(規格単位の容量から) / identity(薬価算定単位が量そのもの) / manual(手動登録)。
      t.string :source, null: false
      # 自動生成時に矛盾を検出したもの。画面で優先的に目視確認する。
      t.boolean :needs_review, null: false, default: false
      t.text :note

      t.timestamps
    end

    add_index :master_medicine_dose_conversions, %i[medicine_code from_unit],
              unique: true, name: "index_medicine_dose_conversions_on_code_and_from_unit"
    add_index :master_medicine_dose_conversions, :needs_review
  end
end
