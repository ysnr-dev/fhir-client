module Master
  # オーダーレイアウトの1マスの共通定義。オーダー項目(item)か表示専用のラベル(label)の
  # どちらかが入る。位置はレイアウト内で一意。レイアウトのモデルは名前の規約で引く
  # (PhysioItemLayoutCell → PhysioItemLayout)。セルがオーダー項目を指す列名が
  # item_code でないマスタは item_code_column を上書きする。
  module ItemLayoutCellModel
    extend ActiveSupport::Concern

    CELL_TYPES = %w[item label].freeze

    included do
      validates :layout_id, presence: true
      validates :grid_row, :grid_column, numericality: { only_integer: true, greater_than: 0 }
      validates :grid_column, uniqueness: { scope: %i[layout_id grid_row] }
      validates :cell_type, inclusion: { in: CELL_TYPES }
      # item は何のオーダー項目かをコードで、label は表示する文言そのものを持つ必要がある。
      validate :item_code_present
      validates :display_name, presence: true, if: -> { cell_type == "label" }
      validate :position_within_layout
    end

    class_methods do
      def item_code_column
        :item_code
      end
    end

    private

    def item_code_present
      column = self.class.item_code_column
      errors.add(column, :blank) if cell_type == "item" && self[column].blank?
    end

    def position_within_layout
      layout = self.class.name.delete_suffix("Cell").constantize.find_by(id: layout_id)
      return errors.add(:layout_id, "が存在しません") unless layout

      errors.add(:grid_row, "が行数(#{layout.row_count})を超えています") if grid_row.to_i > layout.row_count
      if grid_column.to_i > layout.column_count
        errors.add(:grid_column, "が列数(#{layout.column_count})を超えています")
      end
    end
  end
end
