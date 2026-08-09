module Master
  # パネル(1オーダー → 複数結果)の構成。パネル項目の詳細画面から編集する。
  class LabPanelItemsController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::LabPanelItem.all
      # どちらもカンマ区切りで複数指定可(オーダー画面が選択中のパネルの構成を
      # まとめて引くため)。
      if params[:panel_item_code].present?
        scope = scope.where(panel_item_code: params[:panel_item_code].split(","))
      end
      if params[:member_item_code].present?
        scope = scope.where(member_item_code: params[:member_item_code].split(","))
      end

      # 構成項目の名称を添える(オーダー画面がパネルの中身を並べて見せるため)。
      scope = scope
        .joins("LEFT JOIN master_lab_order_items " \
               "ON master_lab_order_items.order_item_code = master_lab_panel_items.member_item_code")
        .select(
          "master_lab_panel_items.*",
          "master_lab_order_items.name AS member_name",
          "master_lab_order_items.short_name AS member_short_name",
        )

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")))
    end

    def create
      record = Master::LabPanelItem.new(record_params)
      # 追加順に並べる(明示されていれば従う)。
      record.display_order ||= next_display_order(record.panel_item_code)
      if record.save
        render json: record, status: :created
      else
        render json: { errors: record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def update
      if @record.update(record_params)
        render json: @record
      else
        render json: { errors: @record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def destroy
      @record.destroy!
      head :no_content
    end

    private

    def next_display_order(panel_item_code)
      (Master::LabPanelItem.where(panel_item_code: panel_item_code).maximum(:display_order) || 0) + 1
    end

    def set_record
      @record = Master::LabPanelItem.find(params[:id])
    end

    def record_params
      params.permit(Master::LabPanelItem.column_names - %w[id created_at updated_at])
    end
  end
end
