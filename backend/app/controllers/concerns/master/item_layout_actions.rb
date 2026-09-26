module Master
  # オーダーレイアウト(伝票のようなグリッド)の編集アクション。レイアウト本体は
  # model_class、セルとオーダー項目のモデルは名前の規約で引く
  # (PhysioItemLayout → PhysioItemLayoutCell / PhysioItem)。セルがオーダー項目を指す
  # 列名が item_code でないマスタは item_code_column を上書きする。
  module ItemLayoutActions
    extend ActiveSupport::Concern

    included do
      before_action :set_record, only: %i[show update destroy]
    end

    def index
      scope = model_class.order(Arel.sql("display_order NULLS LAST"))
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
      model_class.transaction do
        @record.update!(record_params)
        removed = cell_model
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
      model_class.transaction do
        cell_model.where(layout_id: @record.id).delete_all
        @record.destroy!
      end
      head :no_content
    end

    private

    def cell_model
      "#{model_class.name}Cell".constantize
    end

    def item_model
      "#{model_class.name.delete_suffix('ItemLayout')}Item".constantize
    end

    def item_code_column
      "item_code"
    end

    # セルにはオーダー項目の名称を添える(セル側の display_name が空のとき
    # 画面がそのまま使えるように)。
    def cells_for(layout_id)
      cells = cell_model.table_name
      items = item_model.table_name
      cell_model
        .where(layout_id: layout_id)
        .joins("LEFT JOIN #{items} ON #{items}.#{item_code_column} = #{cells}.#{item_code_column}")
        .select(
          "#{cells}.*",
          "#{items}.name AS item_name",
          "#{items}.short_name AS item_short_name",
          "#{items}.kind AS item_kind",
        )
        .order(:grid_row, :grid_column)
    end
  end
end
