module Master
  # パターン食マスタのメンテナンス。食種(MealDietsController)と同じ素朴な形で、
  # 段階(steps)が入れ子の JSON なので record_params だけ自前で組む。
  class MealPatternsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::MealPattern.all
      query = params[:name].presence || params[:keyword].presence
      scope = flexible_name_match(scope, query, SEARCH_COLUMNS) if query

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")), max_per: 500)
    end

    def create
      record = Master::MealPattern.new(record_params)
      record.pattern_code = next_pattern_code if record.pattern_code.blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    private

    SEARCH_COLUMNS = %w[search_name search_kana].freeze

    # 段階は食事オーダーのフォーム値そのもの(入れ子の JSON)なので、オーダーセットの
    # values と同じく permit で形を縛らず、モデルの normalize_steps で知らないキーを落とす。
    def record_params
      permitted = params.permit(:pattern_code, :name, :name_kana, :display_order, :note).to_h
      if params.key?(:steps)
        permitted["steps"] = Array(params[:steps]).map { |s| s.respond_to?(:to_unsafe_h) ? s.to_unsafe_h : s }
      end
      permitted
    end

    # 数字だけのコードの最大値の次。英字混じりのコード(seed の P00001 など)は採番の計算から外す。
    def next_pattern_code
      max = Master::MealPattern.where("pattern_code ~ '^[0-9]+$'")
                               .maximum(Arel.sql("pattern_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      @record = Master::MealPattern.find_by(pattern_code: params[:id]) ||
                Master::MealPattern.find(params[:id])
    end
  end
end
