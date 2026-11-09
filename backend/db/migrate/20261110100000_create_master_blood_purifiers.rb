class CreateMasterBloodPurifiers < ActiveRecord::Migration[8.0]
  # 血液浄化器(ダイアライザ・ヘモダイアフィルタ・血漿分離器など)の施設マスタ。
  #
  # レセプト電算の特定器材マスタ(master_medical_materials)は「ダイアライザー(Ia型)」のような
  # 機能区分で収載されており、製品・膜素材・膜面積を持たないので透析の指示には使えない。
  # 施設が採用している製品をこちらに登録し、算定に使う特定器材コードを紐付ける
  # (製品 N 件 : 特定器材コード 1 件)。
  #
  # 他の施設マスタと同じく FK は張らず、receipt_material_code で疎結合にする
  # (配布マスタは全置換で入れ替わるため)。
  def change
    create_table :master_blood_purifiers do |t|
      t.string :purifier_code, null: false   # 施設内のコード(自動採番可)
      t.string :kind, null: false            # 種別(Master::BloodPurifier::KINDS)
      t.string :name, null: false            # 製品名
      t.string :name_kana                    # カナ(検索用)
      t.string :maker                        # メーカー・販売業者
      t.string :model_number                 # 型番
      t.string :membrane_material            # 膜素材(PS・PES・PMMA など)
      t.decimal :membrane_area, precision: 4, scale: 2 # 膜面積(㎡)
      # 算定に使うレセプト電算の特定器材コード(master_medical_materials.material_code)。
      t.string :receipt_material_code
      t.date :valid_from                     # 採用開始日
      t.date :valid_to                       # 採用終了日
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_blood_purifiers, :purifier_code, unique: true
    add_index :master_blood_purifiers, :kind
    add_index :master_blood_purifiers, :receipt_material_code
  end
end
