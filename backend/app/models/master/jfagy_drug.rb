module Master
  # 剤形・規格・銘柄不明コードマスタ(J-FAGY医薬品領域)のマスタテーブル。
  # コードは GCM + YJコード相当12桁(規格・銘柄部は ZZZ)で、銘柄まで特定
  # できない薬剤アレルゲンを成分名で登録するために使う。
  class JfagyDrug < ApplicationRecord
    self.table_name = "master_jfagy_drugs"

    validates :jfagy_code, presence: true, uniqueness: true
    validates :name, presence: true

    before_save :set_search_columns

    private

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
    end
  end
end
