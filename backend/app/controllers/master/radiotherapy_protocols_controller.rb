module Master
  # 放射線治療プロトコル(定型処方)マスタのメンテナンス。画面から手で登録する単純編集型
  # (docs/radiotherapy-order-design.md §3)。
  class RadiotherapyProtocolsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::RadiotherapyProtocol.all
      # カンマ区切りで複数指定可(保存済みのオーダーから名称を引き直すため)。
      scope = scope.where(code: params[:code].split(",")) if params[:code].present?
      scope = scope.where(enabled: true) if params[:enabled] == "true"
      query = params[:name].presence || params[:keyword].presence
      scope = flexible_name_match(scope, query, %w[search_name search_kana]) if query
      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
    end

    private

    def set_record
      # id ではなくコードでも引けるようにする。
      @record = Master::RadiotherapyProtocol.find_by(code: params[:id]) || Master::RadiotherapyProtocol.find(params[:id])
    end

    SCALARS = %w[code name name_kana intent enabled display_order note].freeze
    VOLUME_KEYS = %i[key label volume_type body_part_code body_part_name laterality_code laterality_name].freeze
    PHASE_KEYS = %i[label modality_code technique_code device_code fractions fractions_per_week].freeze

    def record_params
      params.permit(*SCALARS, volumes: VOLUME_KEYS, phases: [*PHASE_KEYS, { doses: %i[volume_key fraction_dose] }])
    end
  end
end
