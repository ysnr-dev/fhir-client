module Master
  # 検査オーダーレイアウトの編集。配布ファイルが無い画面編集専用マスタなので
  # 取込は持たない。
  class LabOrderItemLayoutsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::LabOrderItemLayout
        .order(Arel.sql("display_order NULLS LAST"))
      render json: paginate(scope)
    end

    # セルを添えて返す。編集画面が1リクエストで開けるようにする。
    def show
      render json: @record.as_json.merge(cells: cells_for(@record.id).as_json)
    end

    # 行数・列数を縮めたときは、範囲外に取り残されたセルを一緒に片付ける。
    # 何マス消したかを返すので、画面は事前の確認に使える。
    def update
      removed = 0
      Master::LabOrderItemLayout.transaction do
        @record.update!(record_params)
        removed = Master::LabOrderItemLayoutCell
          .where(layout_id: @record.id)
          .where("grid_row > :rows OR grid_column > :columns",
                 rows: @record.row_count, columns: @record.column_count)
          .delete_all
      end
      render json: @record.as_json.merge(removed_cells: removed)
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    # 外部キーを張っていないので、ぶら下がるセルも併せて片付ける。
    def destroy
      Master::LabOrderItemLayout.transaction do
        Master::LabOrderItemLayoutCell.where(layout_id: @record.id).delete_all
        @record.destroy!
      end
      head :no_content
    end

    private

    # セルにはオーダー項目の名称を添える(セル側の display_name が空のとき
    # 画面がそのまま使えるように)。
    def cells_for(layout_id)
      Master::LabOrderItemLayoutCell
        .where(layout_id: layout_id)
        .joins("LEFT JOIN master_lab_order_items ON master_lab_order_items.order_item_code = " \
               "master_lab_order_item_layout_cells.order_item_code")
        .select(
          "master_lab_order_item_layout_cells.*",
          "master_lab_order_items.name AS item_name",
          "master_lab_order_items.short_name AS item_short_name",
          "master_lab_order_items.kind AS item_kind",
        )
        .order(:grid_row, :grid_column)
    end
  end
end
