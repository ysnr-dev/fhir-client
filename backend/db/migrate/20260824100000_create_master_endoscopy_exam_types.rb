class CreateMasterEndoscopyExamTypes < ActiveRecord::Migration[8.0]
  # 内視鏡の検査種別(上部消化管内視鏡・下部消化管内視鏡・ERCP など)。
  #
  # 生理検査(master_physio_exam_types)と同じく、施設が自由に定義できるマスタとして
  # 持ち、モダリティが占めていた位置(項目マスタの分類軸・明細 ServiceRequest の
  # category・部門一覧の絞り込み)を引き受ける。コードは独自採番の2桁。
  #
  # 生理検査との違いは jed_exam_category。JED(Japan Endoscopy Database,
  # 日本消化器内視鏡学会)は検査種別を上部・小腸・下部・ERCP の4つに区分している。
  # 施設採番の種別コードと JED の4区分を対応付ける軸として持ち、将来のレポート・
  # JED 出力で種別を機械的に判別できるようにしておく。
  # 気管支鏡など JED 対象外(JED は消化器内視鏡のみ)の種別は NULL。
  def change
    create_table :master_endoscopy_exam_types do |t|
      t.string :exam_type_code, null: false # 独自採番の2桁("01" 〜 "99")
      t.string :name, null: false           # 検査種別名(上部消化管内視鏡 など)
      t.string :short_name                  # 略称(EGD・CS など)
      t.string :name_kana                   # カナ名称。検索用の入力元
      # JED の検査種別区分(upper_gi / small_intestine / lower_gi / ercp)。
      # JED 対象外の種別(気管支鏡 など)は NULL。
      t.string :jed_exam_category
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

    add_index :master_endoscopy_exam_types, :exam_type_code, unique: true
    add_index :master_endoscopy_exam_types, :jed_exam_category
    add_index :master_endoscopy_exam_types, :search_name
  end
end
