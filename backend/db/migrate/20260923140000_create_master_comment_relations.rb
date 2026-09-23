# レセプト電算処理システムのコメント関連テーブル(ck_ALL*.csv)の写し。
# 診療行為コードごとに、記載要領別表Ⅰで関係するコメントコード(または患者の状態コード)と
# その条件(算定したら要る / 入外 / 複数回 …)を持つ。施設設定や項目マスタでコメントコードを
# 選ぶときの候補に使う。コメントマスタと同じく配布ファイルを全置換で取り込む。
class CreateMasterCommentRelations < ActiveRecord::Migration[8.0]
  def change
    create_table :master_comment_relations do |t|
      t.string :change_category
      t.string :placement_category
      t.string :item_number
      t.string :section
      t.string :branch
      t.string :procedure_code, null: false
      t.string :addition_code
      t.string :procedure_name
      t.string :comment_code
      t.string :patient_state_code
      t.string :comment_text
      t.string :changed_on
      t.string :abolished_on
      t.string :condition_category
      t.string :non_billing_reason
      t.string :inpatient_outpatient
      t.string :billing_count
      t.string :publication_order
      t.string :reserve1
      t.string :reserve2
      t.string :reserve3
      t.string :reserve4
      t.string :reserve5
      t.string :reserve6
      t.string :reserve7
      t.string :reserve8
      t.string :reserve9
      t.string :reserve10
      t.string :reserve11
      t.string :reserve12
      t.timestamps
    end
    add_index :master_comment_relations, :procedure_code
    add_index :master_comment_relations, :comment_code
  end
end
