class CreateMasterPhysioExamTypes < ActiveRecord::Migration[8.0]
  # 生理検査の検査種別(心電図・超音波検査・呼吸機能検査 など)。
  #
  # 放射線検査では JJ1017 の「種別(モダリティ)」が検査分野の分類を兼ねていたが、
  # 生理検査は JJ1017 に収載されておらず、これに当たる標準コード体系が無い。
  # そこで施設が自由に定義できるマスタとして持ち、モダリティが占めていた位置
  # (項目マスタの分類軸・明細 ServiceRequest の category・部門一覧の絞り込み)を
  # そのまま引き受ける。
  #
  # コードは独自採番の2桁。他のマスタが6桁なのは配布マスタとの整合のためで、
  # 10件前後にしかならない検査種別には過剰。
  def change
    create_table :master_physio_exam_types do |t|
      t.string :exam_type_code, null: false # 独自採番の2桁("01" 〜 "99")
      t.string :name, null: false           # 検査種別名(心電図・超音波検査 など)
      t.string :short_name                  # 略称(ECG・US など)
      t.string :name_kana                   # カナ名称。検索用の入力元
      t.date :valid_from                    # 有効開始日
      t.date :valid_to                      # 有効終了日
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_short_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_physio_exam_types, :exam_type_code, unique: true
    add_index :master_physio_exam_types, :search_name
  end
end
