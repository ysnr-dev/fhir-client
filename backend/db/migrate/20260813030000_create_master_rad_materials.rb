class CreateMasterRadMaterials < ActiveRecord::Migration[8.0]
  # 放射線検査で使う器材(カテーテル・ガイドワイヤ等)の施設マスタ。
  #
  # レセプト電算の特定器材マスタ(master_medical_materials)は「中心静脈用カテーテル
  # (標準・シングルルーメン)」のような概念的な区分で収載されており、実際に購入して
  # 棚にある製品名とは一致しない。実施入力では技師が手に取った製品を選びたいので、
  # 施設が採用している製品をこちらに登録し、算定に使うレセ電算の特定器材コードを
  # 紐付ける(製品 N 件 : 特定器材コード 1 件)。
  #
  # 他の施設マスタと同じく FK は張らず、receipt_material_code で疎結合にする
  # (配布マスタは全置換で入れ替わるため)。
  def change
    create_table :master_rad_materials do |t|
      t.string :material_code, null: false   # 施設内の器材コード(自動採番可)
      t.string :name, null: false            # 製品名(実際に購入しているもの)
      t.string :name_kana                    # カナ(検索用)
      t.string :maker                        # メーカー・販売業者
      t.string :model_number                 # 型番・規格
      # 算定に使うレセプト電算の特定器材コード(master_medical_materials.material_code)。
      # 未紐付けのまま登録もできる(採用したが算定対象でない器材があるため)。
      t.string :receipt_material_code
      t.string :unit_name                    # 施設での数え方(本・個・組)
      t.date :valid_from                     # 採用開始日
      t.date :valid_to                       # 採用終了日
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_rad_materials, :material_code, unique: true
    add_index :master_rad_materials, :receipt_material_code
  end
end
