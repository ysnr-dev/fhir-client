module Master
  # 内視鏡オーダーレイアウトの1マス。内視鏡オーダー項目(item)か表示専用の
  # ラベル(label)のどちらかが入る。位置はレイアウト内で一意。
  class EndoscopyItemLayoutCell < ApplicationRecord
    self.table_name = "master_endoscopy_item_layout_cells"

    CELL_TYPES = %w[item label].freeze

    validates :layout_id, presence: true
    validates :grid_row, :grid_column, numericality: { only_integer: true, greater_than: 0 }
    validates :grid_column, uniqueness: { scope: %i[layout_id grid_row] }
    validates :cell_type, inclusion: { in: CELL_TYPES }
    # item は何の検査かをコードで、label は表示する文言そのものを持つ必要がある。
    validates :item_code, presence: true, if: -> { cell_type == "item" }
    validates :display_name, presence: true, if: -> { cell_type == "label" }
    validate :position_within_layout

    private

    def position_within_layout
      layout = Master::EndoscopyItemLayout.find_by(id: layout_id)
      return errors.add(:layout_id, "が存在しません") unless layout

      errors.add(:grid_row, "が行数(#{layout.row_count})を超えています") if grid_row.to_i > layout.row_count
      if grid_column.to_i > layout.column_count
        errors.add(:grid_column, "が列数(#{layout.column_count})を超えています")
      end
    end
  end
end
