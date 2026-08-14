class CreateMasterRadDatasetDetails < ActiveRecord::Migration[8.0]
  # 実施入力用データセットの明細。手技料・造影剤・放射線器材の3種を
  # detail_type で区別して1テーブルに縦持ちする。
  #
  # 種別ごとに3テーブルへ分けなかったのは、3種とも「参照先マスタのコード +
  # 既定数量 + 表示順」という同じ形をしており、実施入力モーダルは3種を
  # まとめて1回で引きたいため。参照先が別マスタになるぶんは detail_type つきの
  # LEFT JOIN で名称を解決する(他のマスタと同じく FK は張らない)。
  def change
    create_table :master_rad_dataset_details do |t|
      t.string :dataset_code, null: false  # 親(master_rad_datasets.dataset_code)
      # 明細の種別。参照先マスタが決まる。
      #   procedure … master_medical_procedures.procedure_code(医科診療行為=手技料)
      #   medicine  … master_medicines.medicine_code(造影剤)
      #   material  … master_rad_materials.material_code(放射線器材の施設コード)
      t.string :detail_type, null: false
      t.string :code, null: false          # 参照先マスタのコード
      # 実施入力に初期表示する数量。造影剤は使用量(mL)、器材は本数などの数量。
      # 手技料は数量を持たないので NULL。
      t.decimal :default_quantity, precision: 10, scale: 2
      # 造影剤の既定の投与経路(JP Core の route-codes。静注なら "IV")。
      # 他の種別では使わない。
      t.string :route_code
      t.integer :display_order

      t.timestamps
    end

    add_index :master_rad_dataset_details, :dataset_code
    add_index :master_rad_dataset_details, %i[dataset_code detail_type code],
              unique: true, name: "index_rad_dataset_details_on_dataset_type_code"
  end
end
