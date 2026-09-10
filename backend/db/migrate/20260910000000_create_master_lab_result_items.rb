class CreateMasterLabResultItems < ActiveRecord::Migration[8.0]
  # 検体検査の結果項目(施設マスタ)。検査結果として返ってくる単位で、
  # オーダー項目(master_lab_order_items = 頼む単位)とは別に持つ。
  # 1 つのオーダー項目が複数の結果を返す(血液ガス分析 → pH・pCO2…)ため、
  # 対応は master_lab_order_item_results が 1:N で持つ。
  #
  # 配布の共有項目JLACコードマスタ(master_lab_items)は取込のたびに全件洗い替えになる
  # 参照テーブルなので、施設で決める属性(単位・データ型・将来の基準値)はこちらに置く。
  # JLAC11 / JLAC10 / LOINC は属性として任意に持ち、結果の Observation.code に併記する。
  def change
    create_table :master_lab_result_items do |t|
      t.string :result_item_code, null: false # 施設採番の結果項目コード
      t.string :name, null: false             # 結果項目名称
      t.string :short_name                    # 略称(WBC / CRP など)
      t.string :name_kana                     # カナ名称。検索用の入力元
      # 検査分野(生化学検査 / 血液学的検査 など)。オーダー項目と同じ語彙。
      t.string :category
      # 材料(JLAC11 材料コード 3 桁)。master_lab_specimens.specimen_code に緩く紐づける。
      # 結果登録時の Specimen(材料)はこの値で作る。
      t.string :specimen_code
      # 結果値のデータ型。PQ = 数値 / CD = 順序の無いコード / CO = 順序のあるコード / ST = 文字列
      t.string :data_type, null: false, default: "PQ"
      t.string :display_unit                  # 表示単位(mg/dL など)
      t.string :ucum_unit                     # UCUM 単位。Observation.valueQuantity.code に入れる
      # CD / CO の選択肢。「1：陽性、2：陰性」の形(配布マスタの code_value_list と同じ)。
      t.string :code_value_list
      t.string :value_code_system             # 選択肢の CodeSystem URL(配布マスタの code_oid 相当)
      t.integer :decimal_places               # 表示桁数
      # 標準コード。いずれも任意。JLAC11 は公開分(43+5 項目)だけ入る。
      t.string :jlac11_code
      t.string :jlac10_code
      t.string :loinc_code
      t.date :valid_from
      t.date :valid_to
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_short_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_lab_result_items, :result_item_code, unique: true
    add_index :master_lab_result_items, :jlac11_code
    add_index :master_lab_result_items, :jlac10_code
  end
end
