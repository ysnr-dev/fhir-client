class CreateMasterPatientCautions < ActiveRecord::Migration[8.0]
  # 患者の診療上の注意(転倒リスク・体内金属・DNAR など)の区分マスタ。
  # 実際の注意は上流の FHIR Flag として患者ごとに持ち、このマスタは
  # 「どんな注意があるか」と「患者帯にどのピクトグラムで出すか」を決める。
  # pictogram が NULL の区分は帯に出さない(帯に出すかの真偽値は別に持たない)。
  def change
    create_table :master_patient_cautions do |t|
      t.string :code, null: false        # Flag.code のコード(体系は patient-caution)
      t.string :name, null: false        # 表示名。Flag.code.coding.display に入る
      t.string :category, null: false    # safety / clinical / advance-directive / administrative
      t.string :pictogram                # 患者帯のアイコンキー。NULL なら帯に出さない
      t.integer :display_order

      t.timestamps
    end
    add_index :master_patient_cautions, :code, unique: true
  end
end
