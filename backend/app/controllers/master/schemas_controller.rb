module Master
  # シェーマ台紙のメンテナンス。image(dataURL)は大きいため一覧では返さず、
  # show でのみ全量を返す(選択グリッドは thumbnail で描く)。
  class SchemasController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::Schema.select(Master::Schema.column_names - %w[image])
      if params.key?(:category_id)
        # category_id= (空) は未分類の絞り込みとして扱う。
        scope = scope.where(category_id: params[:category_id].presence)
      end
      scope = scope.where("name LIKE ?", "%#{sanitize_like(params[:name])}%") if params[:name].present?

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")))
    end

    def show
      render json: @record
    end

    def create
      record = Master::Schema.new(record_params)
      # 並び順の指定が無ければ同じカテゴリの中の末尾に置く。
      record.display_order = next_display_order(record.category_id) if params[:display_order].blank?
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

    # 挿入済みの画像は診療記録本文に複製されているため、マスタの削除が
    # 既存記録に影響することはない。
    def destroy
      @record.destroy!
      head :no_content
    end

    private

    def set_record
      @record = Master::Schema.find(params[:id])
    end

    def record_params
      params.permit(Master::Schema.column_names - %w[id created_at updated_at])
    end

    def next_display_order(category_id)
      (Master::Schema.where(category_id: category_id).maximum(:display_order) || 0) + 1
    end
  end
end
