module Master
  # 検体検査オーダー項目のメンテナンス。画面から手動で登録し、
  # JLAC コードは共有項目JLACコードマスタ(master_lab_items)から検索して設定する。
  class LabOrderItemsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::LabOrderItem.all
      # カンマ区切りで複数指定可(保存済みのオーダーから項目情報を一括復元するため)。
      if params[:order_item_code].present?
        scope = scope.where(order_item_code: params[:order_item_code].split(","))
      end
      scope = scope.where(kind: params[:kind]) if params[:kind].present?
      scope = scope.where(category: params[:category]) if params[:category].present?
      scope = scope.where(specimen_code: params[:specimen_code]) if params[:specimen_code].present?
      # active=true は今日オーダーできる項目(有効期間内)だけに絞る。
      if params[:active] == "true"
        scope = scope
          .where("valid_from IS NULL OR valid_from <= ?", Date.current)
          .where("valid_to IS NULL OR valid_to >= ?", Date.current)
      end
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_short_name search_kana])
      end

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")))
    end

    # 検査分野の一覧(絞り込みプルダウン用)。表示順で返す。
    def categories
      list = Master::LabOrderItem
        .where.not(category: [nil, ""])
        .group(:category)
        .minimum(:display_order)
        .sort_by { |_category, order| order || 0 }
        .map(&:first)

      render json: list
    end

    # 検体・採取管・パネル構成をまとめて返す。詳細画面が1リクエストで開けるようにする。
    # 採取管は項目の指定(container_code)が優先で、無ければ検体の既定を使う。
    def show
      specimen = specimen_for(@record.specimen_code)
      container_code = @record.container_code.presence || specimen&.default_container_code
      render json: @record.as_json.merge(
        specimen: specimen.as_json,
        container: container_for(container_code).as_json,
        panel_items: panel_items_for(@record.order_item_code).as_json
      )
    end

    def create
      record = Master::LabOrderItem.new(record_params)
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

    # 外部キーを張っていないので、ぶら下がるパネル構成も併せて片付ける。
    def destroy
      code = @record.order_item_code
      Master::LabOrderItem.transaction do
        Master::LabPanelItem.where(panel_item_code: code).delete_all
        Master::LabPanelItem.where(member_item_code: code).delete_all
        @record.destroy!
      end
      head :no_content
    end

    private

    def specimen_for(specimen_code)
      return nil if specimen_code.blank?

      Master::LabSpecimen.find_by(specimen_code: specimen_code)
    end

    def container_for(container_code)
      return nil if container_code.blank?

      Master::LabContainer.find_by(container_code: container_code)
    end

    def panel_items_for(code)
      Master::LabPanelItem
        .where(panel_item_code: code)
        .joins("LEFT JOIN master_lab_order_items " \
               "ON master_lab_order_items.order_item_code = master_lab_panel_items.member_item_code")
        .select(
          "master_lab_panel_items.*",
          "master_lab_order_items.name AS member_name",
          "master_lab_order_items.short_name AS member_short_name",
          "master_lab_order_items.kind AS member_kind",
        )
        .order(Arel.sql("master_lab_panel_items.display_order NULLS LAST"))
        .order(:id)
    end

    def set_record
      # id ではなくオーダー項目コードでも引けるようにする。
      @record = Master::LabOrderItem.find_by(order_item_code: params[:id]) ||
                Master::LabOrderItem.find(params[:id])
    end

    def record_params
      params.permit(Master::LabOrderItem.column_names - %w[id created_at updated_at])
    end
  end
end
