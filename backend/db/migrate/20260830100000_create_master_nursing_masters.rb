class CreateMasterNursingMasters < ActiveRecord::Migration[8.0]
  # MEDIS 看護実践用語標準マスター(看護行為編・看護観察編)の 4 テーブル。
  # 配布ファイル(cp932 のカンマ区切り txt)を取込画面から全件洗い替えする
  # 読み取り専用マスタで、画面からの編集は持たない(docs/nursing-order-design.md §3)。
  #
  # 配布ファイルは MEDIS の使用許諾が要るためリポジトリに同梱しない。
  def change
    # 看護行為テーブル(koui-ver.4.0.txt、18 列)。
    # 4 階層(A:大分類 / B:目的 / C:行為 / D:修飾語)のコードを連結した 16 桁を
    # code_16 に持ち、FHIR の code に使う(MEDIS の CodeSystem master-nursingAction-16digits)。
    create_table :master_nursing_acts do |t|
      # 変更区分。0=継承 / 1=今版削除 / 2=既削除 / 3=新規 / 5=変更
      t.string :change_category, null: false, default: "0"
      t.string :manage_no, null: false # 管理番号(8 桁)。行の主キー相当
      t.string :level1_code, null: false
      t.string :level1_name
      t.text :level1_definition
      t.string :level2_code, null: false
      t.string :level2_name
      t.text :level2_definition
      t.string :level3_code, null: false
      t.string :level3_name
      t.text :level3_definition
      t.string :level4_code, null: false # D000 は修飾語なし
      t.string :level4_name
      t.text :level4_definition
      t.text :example
      t.string :updated_on
      t.string :successor_manage_no # 削除・統合された用語の移行先
      t.integer :sort_key
      t.string :code_16, null: false # level1〜4 のコード連結
      t.boolean :active, null: false, default: true # 変更区分 1,2 以外
      t.string :search_name # 行為名称+修飾語の正規化
      t.timestamps
    end
    add_index :master_nursing_acts, :manage_no, unique: true
    add_index :master_nursing_acts, :code_16
    add_index :master_nursing_acts, %i[level1_code level2_code level3_code], name: "index_master_nursing_acts_on_levels"
    add_index :master_nursing_acts, :active

    # 看護観察テーブル(kansatsu-ver.4.0.txt、46 列)。
    # 結果 1〜18 は列挙型の選択肢(数値型なら桁数の目安)。配布ファイルの列のまま持つ。
    create_table :master_nursing_observations do |t|
      t.string :change_category, null: false, default: "0"
      t.string :manage_no, null: false # 観察名称管理番号
      # 検索大分類 1〜8。"0" は該当なし、それ以外は中分類番号
      (1..8).each { |n| t.string :"search_category_#{n}" }
      t.string :advanced_category # 高度専門看護別分類(T00 など)
      t.string :name, null: false # 観察名称
      t.string :kana
      t.string :focus # 焦点
      t.string :site  # 部位
      t.string :phase # 位相
      t.string :other # その他
      t.string :criteria # 評価基準
      t.string :result_manage_no # 結果管理番号(観察名称管理番号 + "R")
      t.string :expression_type # 列挙型 / 数値型 / 文字型 / ２数値型
      t.string :unit
      (1..18).each { |n| t.string :"result_#{n}" }
      t.string :updated_on
      t.string :successor_manage_no
      t.string :name2
      t.string :unit_code
      t.string :result_group_code
      t.string :adoption_category
      t.string :exchange_code
      t.boolean :active, null: false, default: true
      t.string :search_name
      t.string :search_kana
      t.timestamps
    end
    # 管理番号は一意でない。用語の統合で番号が再利用され、旧行(変更区分 7、移行先
    # あり)と新行が同じ番号で並ぶことがあるため。
    add_index :master_nursing_observations, :manage_no
    add_index :master_nursing_observations, :active

    # 観察結果テーブル(result-ver.1.8.txt、3 列)。列挙型の選択肢をグループコードで引く。
    create_table :master_nursing_observation_results do |t|
      t.string :result_group_code, null: false
      t.string :result_code, null: false
      t.string :name, null: false
      t.timestamps
    end
    add_index :master_nursing_observation_results, :result_group_code

    # 単位テーブル(unit-ver.1.1.txt、2 列)。
    create_table :master_nursing_units do |t|
      t.string :unit_code, null: false
      t.string :name, null: false
      t.timestamps
    end
    add_index :master_nursing_units, :unit_code, unique: true
  end
end
