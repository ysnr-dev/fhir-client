class CreateMasterDpcTables < ActiveRecord::Migration[8.0]
  # DPC 電子点数表(厚生労働省の配布 Excel)の全シート。診断群分類(14 桁)の決定と、
  # 分類ごとの入院期間・点数の参照に使う。
  #
  # 版(edition)は改定の開始日(YYYYMMDD)。改定をまたぐ入院は基準日(退院日)で版を選ぶので、
  # 取込は同じ版の行だけを入れ替え、別の版の行は残す。版の中でも行ごとに有効期間が違う
  # ことがある(月々の見直しで足された行)ので、各行に valid_from / valid_to を持つ。
  def change
    create_table :master_dpc_editions do |t|
      t.string :edition, null: false
      t.string :source_filename
      t.jsonb :counts, null: false, default: {} # シートごとの件数
      t.datetime :imported_at, null: false
      t.timestamps
    end
    add_index :master_dpc_editions, :edition, unique: true

    # １）ＭＤＣ名称 / ２）分類名称
    create_table :master_dpc_classifications do |t|
      t.string :edition, null: false
      t.string :code, null: false # MDC は 2 桁、分類は MDC + 分類コードの 6 桁
      t.string :level, null: false # mdc / classification
      t.string :name, null: false
      t.string :change_category
      t.string :valid_from
      t.string :valid_to
      t.timestamps
    end
    add_index :master_dpc_classifications, %i[edition code]

    # ３）病態等分類 / ５）年齢、出生時体重等 / 10－1〜10－4）重症度等
    create_table :master_dpc_conditions do |t|
      t.string :edition, null: false
      t.string :mdc6, null: false
      t.string :sheet, null: false # "3" / "5" / "10-1" / "10-2" / "10-3" / "10-4"
      t.string :condition_kind # 条件区分(シート 5 は 1〜8、10 は 1〜15)
      t.string :condition_name
      t.string :code_value # 対応コード(シート 3・10-4)
      t.string :flag
      t.string :category # 区分(肺炎の院内/市中、10-4 の発症時期・スコア)
      t.string :category_name
      t.jsonb :ranges, null: false, default: [] # [{min, max, value}](以上〜未満)
      t.jsonb :options, null: false, default: [] # [{label, value}](10-2 の片眼/両眼など)
      t.string :change_category
      t.string :valid_from
      t.string :valid_to
      t.timestamps
    end
    add_index :master_dpc_conditions, %i[edition mdc6]

    # ６）手術
    create_table :master_dpc_surgeries do |t|
      t.string :edition, null: false
      t.string :mdc6, null: false
      t.string :flag, null: false # 手術フラグ(優先順。99 なし / 97 定義外)
      t.string :code_value, null: false # 対応コード(変換テーブルに入る値)
      t.jsonb :codes, null: false, default: [] # 手術1〜5 の点数表コード(すべて実施で該当)
      t.jsonb :names, null: false, default: []
      t.string :change_category
      t.string :valid_from
      t.string :valid_to
      t.timestamps
    end
    add_index :master_dpc_surgeries, %i[edition mdc6]

    # ７）手術・処置等１ / ８）手術・処置等２
    create_table :master_dpc_procedures do |t|
      t.string :edition, null: false
      t.string :mdc6, null: false
      t.integer :kind, null: false # 1 / 2
      t.string :flag, null: false
      t.string :code_value, null: false
      t.string :surgery_condition # 手術との組み合わせ条件(この手術を実施したときだけ該当)
      t.jsonb :codes, null: false, default: [] # 処置等(1)・(2) のコード(すべて実施で該当)
      t.jsonb :names, null: false, default: []
      t.string :change_category
      t.string :valid_from
      t.string :valid_to
      t.timestamps
    end
    add_index :master_dpc_procedures, %i[edition mdc6 kind]

    # ９）定義副傷病名
    create_table :master_dpc_comorbidities do |t|
      t.string :edition, null: false
      t.string :mdc6, null: false
      t.string :code_value, null: false
      t.string :flag, null: false # 1 手術あり・なし共通 / 2 手術なし / 3 手術あり
      t.string :icd10, null: false # 記号を外した ICD-10
      t.string :match_type, null: false # exact / prefix
      t.string :icd_pattern, null: false
      t.string :icd_name
      t.string :change_category
      t.string :valid_from
      t.string :valid_to
      t.timestamps
    end
    add_index :master_dpc_comorbidities, %i[edition mdc6]

    # 11）診断群分類点数表
    create_table :master_dpc_points do |t|
      t.string :edition, null: false
      t.integer :serial
      t.string :dpc_code, null: false
      t.string :disease_name
      t.string :surgery_name
      t.string :proc1_name
      t.string :proc2_name
      t.string :comorbidity_name
      t.string :severity_name
      t.integer :days1 # 入院日Ⅰ〜Ⅲ(包括対象外の分類は空)
      t.integer :days2
      t.integer :days3
      t.integer :points1 # 入院期間Ⅰ〜Ⅲの 1 日あたり点数(「-」は空)
      t.integer :points2
      t.integer :points3
      t.string :change_category
      t.string :valid_from
      t.string :valid_to
      t.timestamps
    end
    add_index :master_dpc_points, %i[edition dpc_code]

    # 12）変換テーブル
    create_table :master_dpc_conversions do |t|
      t.string :edition, null: false
      t.integer :serial
      t.string :dpc_code, null: false
      t.string :mdc6, null: false
      t.boolean :bundled, null: false # 包括対象
      t.jsonb :branch_values, null: false, default: {} # 分岐ごとの値("a" と空欄は問わない)
      t.string :change_category
      t.string :valid_from
      t.string :valid_to
      t.timestamps
    end
    add_index :master_dpc_conversions, %i[edition mdc6]

    # 13）出来高算定手術等コード
    create_table :master_dpc_fee_for_service_codes do |t|
      t.string :edition, null: false
      t.string :kind, null: false # surgery / test / patient / drug
      t.string :category # 00 移植 / 01 厚生労働大臣指定
      t.string :code
      t.text :name
      t.string :change_category
      t.string :valid_from
      t.string :valid_to
      t.timestamps
    end
    add_index :master_dpc_fee_for_service_codes, %i[edition kind]

    # 14）CCPM対応
    create_table :master_dpc_ccpms do |t|
      t.string :edition, null: false
      t.string :mdc6, null: false
      t.string :dpc_code, null: false
      t.string :ccpm_code, null: false
      t.string :change_category
      t.string :valid_from
      t.string :valid_to
      t.timestamps
    end
    add_index :master_dpc_ccpms, %i[edition dpc_code]

    # ダミーコード一覧
    create_table :master_dpc_dummy_codes do |t|
      t.string :edition, null: false
      t.string :code, null: false
      t.string :name, null: false
      t.string :note
      t.timestamps
    end
    add_index :master_dpc_dummy_codes, %i[edition code]

    add_column :master_dpc_icd_codes, :edition, :string
    add_column :master_dpc_icd_codes, :change_category, :string
    add_index :master_dpc_icd_codes, %i[edition icd10]
    reversible do |dir|
      # 取込済みの行は 1 つの版なので、行の有効期間の開始日のうち最も古いものを版にする
      # (版の途中で足された行は開始日が遅い)。
      dir.up do
        execute <<~SQL.squish
          UPDATE master_dpc_icd_codes
          SET edition = (SELECT MIN(valid_from) FROM master_dpc_icd_codes)
          WHERE edition IS NULL
        SQL
      end
    end
  end
end
