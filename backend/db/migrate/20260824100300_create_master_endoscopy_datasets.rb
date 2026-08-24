class CreateMasterEndoscopyDatasets < ActiveRecord::Migration[8.0]
  # 内視鏡の実施入力用データセット。実施入力で毎回登録することになる
  # 手技料(医科診療行為)・薬剤(医薬品)・特定保険医療材料の組み合わせに名前を
  # 付けてまとめたもので、内視鏡オーダー項目マスタ(master_endoscopy_items)に紐付けて
  # おくと、実施入力モーダルの初期明細として展開される。
  #
  # material の参照先は生理検査と同じく master_medical_materials の直接参照。
  # 内視鏡は生検鉗子は技術料包括だが止血クリップ等の特定保険医療材料が実在する
  # ので、この構成がそのまま活きる。施設内の器材マスタ(master_rad_materials 相当)
  # は生理検査と同じ理由で持たない。
  def change
    create_table :master_endoscopy_datasets do |t|
      t.string :dataset_code, null: false  # 施設内のデータセットコード(自動採番可)
      t.string :name, null: false          # データセット名(例: 上部内視鏡標準セット)
      t.string :name_kana                  # カナ(検索用)
      t.date :valid_from                   # 運用開始日
      t.date :valid_to                     # 運用終了日
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_endoscopy_datasets, :dataset_code, unique: true

    create_table :master_endoscopy_dataset_details do |t|
      t.string :dataset_code, null: false  # 親(master_endoscopy_datasets.dataset_code)
      # 明細の種別。参照先マスタが決まる。
      #   procedure … master_medical_procedures.procedure_code(医科診療行為=手技料)
      #   medicine  … master_medicines.medicine_code(薬剤)
      #   material  … master_medical_materials.material_code(特定保険医療材料)
      t.string :detail_type, null: false
      t.string :code, null: false          # 参照先マスタのコード
      # 実施入力に初期表示する数量。薬剤は使用量、器材は本数などの数量。
      # 手技料は数量を持たないので NULL。
      t.decimal :default_quantity, precision: 10, scale: 2
      # 薬剤の既定の投与経路(JP Core の route-codes。静注なら "IV")。
      # 他の種別では使わない。
      t.string :route_code
      t.integer :display_order
      # 実施入力を開いたときに、この明細を最初から並べるか。
      # 通常使うものが大半なので既定は true にし、例外の方を外す運用にする。
      t.boolean :default_selected, null: false, default: true

      t.timestamps
    end

    add_index :master_endoscopy_dataset_details, :dataset_code
    add_index :master_endoscopy_dataset_details, %i[dataset_code detail_type code],
              unique: true, name: "index_endoscopy_dataset_details_on_dataset_type_code"
  end
end
