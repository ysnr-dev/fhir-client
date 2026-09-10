module Master
  # 検体検査の結果項目(施設マスタ)のメンテナンス。
  # 配布の共有項目JLACコードマスタ(master_jlac_items)から属性を引き当てて登録する。
  class LabResultItemsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::LabResultItem.all
      # コード類はカンマ区切りで複数指定可(保存済みの結果から項目情報を一括復元するため)。
      %i[result_item_code jlac11_code jlac10_code].each do |column|
        scope = scope.where(column => params[column].split(",")) if params[column].present?
      end
      # JLAC11 の前方一致(カンマ区切りで複数)。結果項目マスタ導入前の検査結果は試薬・機器
      # 単位の 17 桁を持ち、マスタの代表コードと下 5 桁(測定法・結果単位)が違うことが多いので、
      # 測定物・識別・材料の 12 桁で引き当てるために使う。
      if params[:jlac11_prefix].present?
        patterns = params[:jlac11_prefix].split(",").map { |prefix| "#{sanitize_like(prefix)}%" }
        scope = scope.where("master_lab_result_items.jlac11_code LIKE ANY (ARRAY[?])", patterns)
      end
      scope = scope.where(category: params[:category]) if params[:category].present?
      scope = scope.where(specimen_code: params[:specimen_code]) if params[:specimen_code].present?
      scope = scope.where(data_type: params[:data_type]) if params[:data_type].present?
      # active=true は今日使える項目(有効期間内)だけに絞る。
      if params[:active] == "true"
        scope = scope
          .where("valid_from IS NULL OR valid_from <= ?", Date.current)
          .where("valid_to IS NULL OR valid_to >= ?", Date.current)
      end
      if params[:name].present?
        # JLAC11 前方一致などと同じく、表名で修飾しておく。
        scope = flexible_name_match(
          scope, params[:name],
          %w[master_lab_result_items.search_name master_lab_result_items.search_short_name master_lab_result_items.search_kana]
        )
      end

      # 材料名と基準値を添える(結果登録画面の「材料」列・H/L の自動判定・Specimen の表示名に使う)。
      # コード一括照会は 1 オーダーぶんを 1 回で引くので上限を広げる。
      result = paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
      render json: result.merge(items: Master::LabResultItem.as_json_with_details(result[:items].to_a))
    end

    # 材料名・基準値と、この結果項目を返すオーダー項目を添えて返す。
    def show
      render json: Master::LabResultItem.as_json_with_details([@record]).first.merge(
        "order_items" => order_items_for(@record.result_item_code).as_json
      )
    end

    # 外部キーを張っていないので、ぶら下がる対応表と基準値も併せて片付ける。
    def destroy
      Master::LabResultItem.transaction do
        Master::LabOrderItemResult.where(result_item_code: @record.result_item_code).delete_all
        Master::LabReferenceRange.where(result_item_code: @record.result_item_code).delete_all
        @record.destroy!
      end
      head :no_content
    end

    private

    def order_items_for(code)
      Master::LabOrderItemResult
        .where(result_item_code: code)
        .joins("LEFT JOIN master_lab_order_items " \
               "ON master_lab_order_items.order_item_code = master_lab_order_item_results.order_item_code")
        .select(
          "master_lab_order_item_results.*",
          "master_lab_order_items.name AS order_item_name",
          "master_lab_order_items.kind AS order_item_kind",
        )
        .order(:id)
    end

    def set_record
      # id ではなく結果項目コードでも引けるようにする。
      @record = Master::LabResultItem.find_by(result_item_code: params[:id]) ||
                Master::LabResultItem.find(params[:id])
    end
  end
end
