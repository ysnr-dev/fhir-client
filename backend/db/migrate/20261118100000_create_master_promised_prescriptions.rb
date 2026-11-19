class CreateMasterPromisedPrescriptions < ActiveRecord::Migration[8.0]
  def change
    # 約束処方(院内で決めた組み合わせと量に名前を付けたもの。軟膏の混合など)。
    # 処方では構成薬をそれぞれの明細に展開し、名称と量を明細に写す。
    create_table :master_promised_prescriptions do |t|
      t.string :code, null: false
      t.string :name, null: false
      t.string :name_kana
      # 構成薬の量が成り立つ基準の量と単位(例: 50 g、1 包)。処方ではこの量に対する比で構成薬の量を出す。
      t.decimal :base_amount, precision: 10, scale: 3, null: false
      t.string :unit_name, null: false
      # 選んだ Rp の調剤指示に「混合」を付ける。
      t.boolean :mix, null: false, default: false
      t.integer :display_order
      t.date :valid_from
      t.date :valid_to
      t.text :note
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_promised_prescriptions, :code, unique: true

    create_table :master_promised_prescription_items do |t|
      t.references :promised_prescription, null: false,
                                           foreign_key: { to_table: :master_promised_prescriptions, on_delete: :cascade }
      # master_medicines.medicine_code(レセプト電算コード)。医薬品マスタは取込のたびに
      # 入れ直されて id が変わるため、id ではなくコードで緩く紐づける。
      t.string :medicine_code, null: false
      # 基準量あたりの量と、その単位(登録したときの医薬品の単位)。
      t.decimal :amount, precision: 10, scale: 3, null: false
      t.string :unit_name
      t.integer :display_order

      t.timestamps
    end

    add_index :master_promised_prescription_items, %i[promised_prescription_id medicine_code], unique: true,
                                                                                               name: "idx_promised_prescription_items_unique"
    add_index :master_promised_prescription_items, :medicine_code
  end
end
