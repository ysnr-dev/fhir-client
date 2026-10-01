class CreateMasterDpcIcdCodes < ActiveRecord::Migration[8.0]
  # DPC 電子点数表の「４）ＩＣＤ」シート(ICD-10 → 診断群分類上6桁の対応表)。
  # 様式1 で「医療資源を最も投入した傷病名」の ICD-10 から診断群分類を引き、
  # 項目の必須判定に使う。
  #
  # 配布ファイルの ICD コードは小数点なしで、"I50$"(I50 で始まるものすべて)、
  # "M!!!!"(表に無い M コードすべて)のような表記が混ざる。照合しやすいように
  # 記号を外した icd10 と照合方法 match_type に分けて持ち、元の表記も残す。
  def change
    create_table :master_dpc_icd_codes do |t|
      t.string :mdc6, null: false       # MDCコード2桁 + 分類コード4桁(末尾が "x" の分類もある)
      t.string :icd10, null: false      # 記号を外した ICD-10("I50$" → "I50"、"M!!!!" → "M")
      t.string :match_type, null: false # exact:完全一致 / prefix:前方一致 / fallback:表に無いコードの受け皿
      t.string :icd_pattern, null: false # 配布ファイルの表記そのまま
      t.string :icd_name
      t.string :valid_from              # 有効期間(YYYYMMDD)
      t.string :valid_to

      t.timestamps
    end

    add_index :master_dpc_icd_codes, :icd10
    add_index :master_dpc_icd_codes, :mdc6
  end
end
