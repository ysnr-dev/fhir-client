class CreateMasterMedicalMaterials < ActiveRecord::Migration[8.0]
  # 特定器材(特定保険医療材料)マスタ。レセプト電算処理システムの特定器材マスター
  # (t_ALL*.csv、マスター種別 T、38列)をそのまま取り込む。放射線検査の実施入力で
  # 使用した器材(カテーテル・ガイドワイヤ等)を選ぶために使う。
  #
  # 列は医薬品マスタ(master_medicines、y_ALL*.csv)と同じくレコード仕様の項番順に
  # 並べ、未使用の予備項目も落とさず持つ。告示の改定で予備が使われ始めても
  # 取込側を直さずに済むため。
  def change
    create_table :master_medical_materials do |t|
      t.string :change_category                     # 1 変更区分
      t.string :master_type                         # 2 マスター種別(T固定)
      t.string :material_code, null: false          # 3 特定器材コード(9桁)
      t.integer :name_kanji_length                  # 4 特定器材名・規格名 漢字有効桁数
      t.string :name                                # 5 同 漢字名称
      t.integer :name_kana_length                   # 6 同 カナ有効桁数
      t.string :name_kana                           # 7 同 カナ名称
      t.string :unit_code                           # 8 単位コード
      t.integer :unit_name_length                   # 9 単位 漢字有効桁数
      t.string :unit_name                           # 10 単位 漢字名称
      t.string :price_type                          # 11 新又は現金額・金額種別
      t.decimal :price, precision: 13, scale: 2     # 12 新又は現金額
      t.string :reserve1                            # 13 予備(未使用)
      t.string :age_addition_category               # 14 年齢加算区分
      t.string :lower_age_limit                     # 15 上下限年齢 下限年齢
      t.string :upper_age_limit                     # 16 同 上限年齢
      t.string :reserve2                            # 17 予備(未使用)
      t.string :reserve3                            # 18 予備(未使用)
      t.string :name_change_flag                    # 19 漢字名称変更区分
      t.string :kana_change_flag                    # 20 カナ名称変更区分
      t.string :oxygen_category                     # 21 酸素等区分
      t.string :material_category                   # 22 特定器材種別
      t.string :price_cap_flag                      # 23 上限価格
      t.string :price_cap_points                    # 24 上限点数
      t.string :reserve4                            # 25 予備(未使用)
      t.string :publication_order                   # 26 公表順序番号
      t.string :abolition_related_code              # 27 廃止・新設関連
      t.string :changed_on                          # 28 変更年月日
      t.string :transitional_measure_on             # 29 経過措置年月日
      t.string :abolished_on                        # 30 廃止年月日
      t.string :notification_table_number           # 31 告示番号 別表番号
      t.string :notification_section_number         # 32 同 区分番号
      t.string :dpc_category                        # 33 DPC適用区分
      t.string :reserve5                            # 34 予備(未使用)
      t.string :reserve6                            # 35 予備(未使用)
      t.string :reserve7                            # 36 予備(未使用)
      t.string :basic_name                          # 37 基本漢字名称
      t.string :remanufactured_single_use_device    # 38 再製造単回使用医療機器

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_medical_materials, :material_code, unique: true
    add_index :master_medical_materials, :name
    # 実施入力の器材検索は「有効なものだけ」を出すため廃止年月日で絞る。
    add_index :master_medical_materials, :abolished_on
  end
end
