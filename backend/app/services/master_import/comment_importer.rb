module MasterImport
  # コメントマスター(c_ALL*.csv、ヘッダー無し・30 列)を master_comments に全置換で取り込む。
  # レイアウトは診療報酬情報提供サービスの「ファイルレイアウト」〈コメントマスター〉の項番順。
  # レセプト編集情報(カラム位置・桁数)①〜④は連番を付けて平坦に展開する。
  class CommentImporter < CsvImporter
    self.model = Master::Comment
    self.columns = %i[
      change_category master_type category pattern serial_number
      name_kanji_length name name_kana_length name_kana
      column_position_1 digits_1 column_position_2 digits_2
      column_position_3 digits_3 column_position_4 digits_4
      reserve1 reserve2 selective_flag changed_on abolished_on
      comment_code publication_order
      reserve3 reserve4 reserve5 reserve6 reserve7 reserve8
    ].freeze
    self.search_columns = { search_name: :name, search_kana: :name_kana }.freeze
  end
end
