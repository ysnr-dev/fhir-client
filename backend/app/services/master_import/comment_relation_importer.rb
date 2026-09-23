module MasterImport
  # コメント関連テーブル(ck_ALL*.csv、ヘッダー無し・30 列)を master_comment_relations に
  # 全置換で取り込む。レイアウトは支払基金「コメント関連テーブル ファイル仕様説明書」の項番順。
  class CommentRelationImporter < CsvImporter
    self.model = Master::CommentRelation
    self.columns = %i[
      change_category placement_category item_number section branch
      procedure_code addition_code procedure_name
      comment_code patient_state_code comment_text
      changed_on abolished_on
      condition_category non_billing_reason inpatient_outpatient billing_count
      publication_order
      reserve1 reserve2 reserve3 reserve4 reserve5 reserve6
      reserve7 reserve8 reserve9 reserve10 reserve11 reserve12
    ].freeze
  end
end
