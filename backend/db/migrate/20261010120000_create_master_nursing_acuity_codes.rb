class CreateMasterNursingAcuityCodes < ActiveRecord::Migration[8.0]
  # 重症度、医療・看護必要度のレセプト電算処理システム用コード一覧(厚生労働省 通知 別紙7 の別表1・別表2)。
  # 別表1 は A・C 項目に当たるコード、別表2 は「A3 注射薬剤3種類以上の管理」の種類数から除く薬剤。
  # 取込はそれぞれ全件洗い替え(docs/nursing-acuity-design.md §7)。
  def change
    create_table :master_nursing_acuity_codes do |t|
      # item = 別表1(項目に当たるコード)、a3_exclusion = 別表2(A3 の種類数から除く薬剤)。
      t.string :kind, null: false
      # 評価票の項目コード(A1 / A6-1 / C21 など。frontend の NURSING_ACUITY_FORMS と同じ書き方)。
      t.string :item_code, null: false
      # 配布ファイルの項目の表記そのまま("専門的な治療・処置（① 抗悪性腫瘍剤の使用（注射剤のみ））")。
      t.string :item_label
      # レセプト電算処理システム用コード(診療行為 / 医薬品、9 桁)。
      t.string :code, null: false
      t.string :name
      # 「※」の付いたコード(必要度Ⅰを評価する場合のみに用いる)。
      t.boolean :form_i_only, null: false, default: false
      # C 項目の評価の対象になる日数(手術等の当日を含む)。A 項目は空。
      t.integer :days
      t.integer :display_order, null: false
      t.timestamps
    end
    add_index :master_nursing_acuity_codes, %i[kind code]
  end
end
