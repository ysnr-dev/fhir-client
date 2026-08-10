module Master
  # 放射線オーダーレイアウトの1マス。レイアウト編集画面から操作する。
  class RadItemLayoutCellsController < BaseController
    before_action :set_record, only: %i[update destroy]

    def create
      record = Master::RadItemLayoutCell.new(record_params)
      if record.save
        render json: record, status: :created
      else
        render json: { errors: record.errors.full_messages }, status: :unprocessable_content
      end
    end

    # 位置(grid_row / grid_column)の変更が「移動」。移動先に別のセルが居れば
    # 位置を入れ替える。伝票編集で最も多い操作なので専用エンドポイントは作らず
    # update に寄せている。
    def update
      target_row = params.key?(:grid_row) ? params[:grid_row].to_i : @record.grid_row
      target_column = params.key?(:grid_column) ? params[:grid_column].to_i : @record.grid_column
      occupant = Master::RadItemLayoutCell
        .where(layout_id: @record.layout_id, grid_row: target_row, grid_column: target_column)
        .where.not(id: @record.id)
        .first

      Master::RadItemLayoutCell.transaction do
        if occupant
          from_row = @record.grid_row
          from_column = @record.grid_column
          # 位置のユニーク制約に当たらないよう、入れ替え相手を一旦グリッド外へ
          # 退避してから動かす(update_columns は検証を通らないので 0 を置ける)。
          occupant.update_columns(grid_row: 0, grid_column: 0)
          @record.update!(record_params)
          occupant.update!(grid_row: from_row, grid_column: from_column)
        else
          @record.update!(record_params)
        end
      end
      render json: @record
    rescue ActiveRecord::RecordInvalid => e
      render json: { errors: e.record.errors.full_messages }, status: :unprocessable_content
    end

    def destroy
      @record.destroy!
      head :no_content
    end

    private

    def set_record
      @record = Master::RadItemLayoutCell.find(params[:id])
    end

    def record_params
      params.permit(Master::RadItemLayoutCell.column_names - %w[id created_at updated_at])
    end
  end
end
