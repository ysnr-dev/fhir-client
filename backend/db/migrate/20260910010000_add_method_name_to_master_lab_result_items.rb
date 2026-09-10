class AddMethodNameToMasterLabResultItems < ActiveRecord::Migration[8.0]
  # 測定法(試薬・機器)。JLAC11 は 17 桁の中に測定法 3 桁を含むが、この 3 桁だけを
  # 取り出しても意味を引ける表が無いので、名称を施設マスタの属性として持たせる。
  # 結果登録時に Observation.method(text)へ写す。
  def up
    add_column :master_lab_result_items, :method_name, :string

    # 既存行は、JLAC11 が一致する配布の共有項目JLACコードマスタの測定法名称で埋める
    # (配布マスタの測定法名称は試薬・機器の製品名で、JLAC11 の測定法コードが指すもの)。
    execute(<<~SQL.squish)
      UPDATE master_lab_result_items AS r
         SET method_name = j.jlac11_method
        FROM master_jlac_items AS j
       WHERE r.jlac11_code = j.jlac11_code
         AND r.method_name IS NULL
         AND COALESCE(j.jlac11_method, '') <> ''
    SQL
  end

  def down
    remove_column :master_lab_result_items, :method_name
  end
end
