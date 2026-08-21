module Master
  # シェーマカテゴリのメンテナンス。件数が少ない前提でページングせず全件返し、
  # ツリーの組み立てはフロント側で行う。
  class SchemaCategoriesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      categories = Master::SchemaCategory.order(Arel.sql("display_order NULLS LAST"), :id)
      render json: { total: categories.count, items: categories }
    end

    def create
      record = Master::SchemaCategory.new(record_params)
      # 並び順の指定が無ければ同じ親の中の末尾に置く。
      record.display_order = next_display_order(record.parent_id) if params[:display_order].blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    # 子カテゴリや所属シェーマが残ったまま消すと辿れない孤児ができるため拒否する
    # (外部キーを張らない方針のため、整合性はここで守る)。
    def destroy
      if Master::SchemaCategory.exists?(parent_id: @record.id)
        render json: { errors: ["子カテゴリが残っているため削除できません"] }, status: :unprocessable_content
      elsif Master::Schema.exists?(category_id: @record.id)
        render json: { errors: ["このカテゴリのシェーマが残っているため削除できません"] }, status: :unprocessable_content
      else
        @record.destroy!
        head :no_content
      end
    end

    private

    def next_display_order(parent_id)
      (Master::SchemaCategory.where(parent_id: parent_id).maximum(:display_order) || 0) + 1
    end
  end
end
