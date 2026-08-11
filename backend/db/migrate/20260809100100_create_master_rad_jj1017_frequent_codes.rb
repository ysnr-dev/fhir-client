class CreateMasterRadJj1017FrequentCodes < ActiveRecord::Migration[8.0]
  # JJ1017 の「代表的頻用コード集」(別表F)。部品コードを組み合わせた32桁コードと
  # その意味の一覧で、多くの施設で使われる検査の既製品にあたる(指針 5.2)。
  #
  # 放射線オーダー項目マスタの初期データを一括生成する種として持つだけなので、
  # 画面からの編集は行わず、取込で全件洗い替えする。
  def change
    create_table :master_rad_jj1017_frequent_codes do |t|
      # 別表F のシート区分。rad_exam(F1 放射線検査) / ultrasound(F2 超音波検査) /
      # radiotherapy(F3 放射線治療)。
      t.string :category, null: false
      t.string :jj1017_code, null: false # JJ1017-32(32桁)
      t.string :name, null: false        # コード意味
      t.integer :display_order           # 別表の掲載順(整理番号)

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name

      t.timestamps
    end

    add_index :master_rad_jj1017_frequent_codes, %i[category jj1017_code], unique: true,
              name: "index_rad_frequent_codes_on_category_and_code"
    add_index :master_rad_jj1017_frequent_codes, :search_name
  end
end
