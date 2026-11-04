# SS-MIX2 のオーダ No の対応表(docs/ssmix2-export-design.md §5.1)。id がそのまま番号になる。
class Ssmix2OrderNumber < ApplicationRecord
  validates :resource_ref, presence: true, uniqueness: true
end
