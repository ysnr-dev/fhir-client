module Master
  # 病棟マップのレイアウト。配布マスタは無く、施設がエディタで描いて保存する。
  # 1 病棟 1 行なので、病棟からは index?ward_location_id= で引く(手術室ブロックと同じ形)。
  class WardMapsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::WardMap.all
      if params[:ward_location_id].present?
        scope = scope.where(ward_location_id: params[:ward_location_id].split(","))
      end

      render json: paginate(scope.order(:ward_name, :id))
    end

    private

    # BaseController の permit(column_names) は jsonb のネストを黙って落とすので、
    # layout だけは丸ごと受け取る(形の検証はモデルの layout_shape が担う)。
    def record_params
      permitted = params.permit(:ward_location_id, :ward_name, :note)
      if params.key?(:layout)
        raw = params[:layout]
        permitted[:layout] = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw
      end
      permitted
    end
  end
end
