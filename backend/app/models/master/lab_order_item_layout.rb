module Master
  # 検査オーダー画面の項目配置(検査伝票のようなグリッド)。グリッドの大きさと
  # 名前を持ち、1マスの中身は LabOrderItemLayoutCell が持つ。
  class LabOrderItemLayout < ApplicationRecord
    self.table_name = "master_lab_order_item_layouts"

    # 1辺の上限。全110項目を並べても 25行×5列で収まるので、誤入力で
    # 巨大なグリッドを作ってしまわないよう抑えておく。
    MAX_SIZE = 50

    validates :name, presence: true, uniqueness: true
    validates :row_count, :column_count,
              numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: MAX_SIZE }
  end
end
