module Master
  # 生理検査オーダー画面の項目配置(伝票のようなグリッド)。グリッドの大きさと
  # 名前を持ち、1マスの中身は PhysioItemLayoutCell が持つ。
  class PhysioItemLayout < ApplicationRecord
    self.table_name = "master_physio_item_layouts"

    # 1辺の上限。誤入力で巨大なグリッドを作ってしまわないよう抑えておく。
    MAX_SIZE = 50

    validates :name, presence: true, uniqueness: true
    validates :row_count, :column_count,
              numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: MAX_SIZE }
  end
end
