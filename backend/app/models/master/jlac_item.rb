module Master
  # 配布の共有項目JLACコードマスタ(電子カルテ情報共有サービスの配布 CSV)。取込のたびに
  # 全件洗い替えする参照テーブルで、施設が値を持つ項目マスタ(LabOrderItem / LabResultItem)とは
  # 役割が違う。結果項目マスタはここから JLAC コード・単位・データ型を引き当てて作る。
  class JlacItem < ApplicationRecord
    self.table_name = "master_jlac_items"

    validates :jlac11_code, presence: true, uniqueness: true

    before_save :set_search_columns

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(fhir_item_name)
      self.search_abbreviation = SearchNormalizer.normalize(abbreviation)
      self.search_major_item = SearchNormalizer.normalize(major_item)
    end
  end
end
