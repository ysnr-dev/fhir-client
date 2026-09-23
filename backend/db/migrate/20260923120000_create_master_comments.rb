# レセプト電算処理システムのコメントマスター(c_ALL*.csv)の写し。
# 医事会計へ送るコメント(830 文字・842 数値・850 年月日・820 選択式 など)のコードと
# 形式(パターン)の参照用。診療行為マスタと同じく配布ファイルを全置換で取り込む。
class CreateMasterComments < ActiveRecord::Migration[8.0]
  def change
    create_table :master_comments do |t|
      t.string :change_category
      t.string :master_type
      t.string :category
      t.string :pattern
      t.string :serial_number
      t.integer :name_kanji_length
      t.string :name
      t.integer :name_kana_length
      t.string :name_kana
      # レセプト編集情報 ①〜④(コメント文の中で値を差し込む位置と桁数)。
      t.string :column_position_1
      t.string :digits_1
      t.string :column_position_2
      t.string :digits_2
      t.string :column_position_3
      t.string :digits_3
      t.string :column_position_4
      t.string :digits_4
      t.string :reserve1
      t.string :reserve2
      t.string :selective_flag
      t.string :changed_on
      t.string :abolished_on
      t.string :comment_code, null: false
      t.string :publication_order
      t.string :reserve3
      t.string :reserve4
      t.string :reserve5
      t.string :reserve6
      t.string :reserve7
      t.string :reserve8
      t.string :search_name
      t.string :search_kana
      t.timestamps
    end
    add_index :master_comments, :comment_code, unique: true
    add_index :master_comments, :pattern
    add_index :master_comments, :abolished_on
  end
end
