module Master
  # 郵便番号マスタ(日本郵便 utf_ken_all.csv)。配布ファイルそのままの参照表なので
  # 画面からの編集は持たず、取込と検索だけを行う。
  class PostalCode < ApplicationRecord
    self.table_name = "master_postal_codes"

    validates :postal_code, presence: true
    validates :prefecture, presence: true
    validates :city, presence: true

    scope :for_code, ->(code) { where(postal_code: code.to_s.gsub(/\D/, "")) }
  end
end
