module Master
  # セット(1オーダー → 複数の撮影)の構成。オーダー項目の詳細画面から編集する。
  class RadSetItemsController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::RadSetItem.all
      # どちらもカンマ区切りで複数指定可(オーダー画面が選択中のセットの構成を
      # まとめて引くため)。
      scope = scope.where(set_item_code: params[:set_item_code].split(",")) if params[:set_item_code].present?
      if params[:member_item_code].present?
        scope = scope.where(member_item_code: params[:member_item_code].split(","))
      end

      # 構成項目の名称を添える(オーダー画面がセットの中身を並べて見せるため)。
      scope = scope
        .joins("LEFT JOIN master_rad_items " \
               "ON master_rad_items.item_code = master_rad_set_items.member_item_code")
        .select(
          "master_rad_set_items.*",
          "master_rad_items.name AS member_name",
          "master_rad_items.short_name AS member_short_name",
          "master_rad_items.jj1017_code AS member_jj1017_code",
        )

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")))
    end

    def create
      record = Master::RadSetItem.new(record_params)
      # 追加順に並べる(明示されていれば従う)。
      record.display_order ||= next_display_order(record.set_item_code)
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

    def next_display_order(set_item_code)
      (Master::RadSetItem.where(set_item_code: set_item_code).maximum(:display_order) || 0) + 1
    end

    def set_record
      @record = Master::RadSetItem.find(params[:id])
    end

    def record_params
      params.permit(Master::RadSetItem.column_names - %w[id created_at updated_at])
    end
  end
end
