module Master
  # 食種の種別(分類)のメンテナンス。生理検査の PhysioExamTypesController と同じ形で、
  # 配布マスタが無いので取込は持たず、画面から施設が自由に登録する。
  class MealCategoriesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::MealCategory.all
      # カンマ区切りで複数指定可(食種一覧に載っている分類の名称をまとめて引くため)。
      if params[:category_code].present?
        scope = scope.where(category_code: params[:category_code].split(","))
      end
      # active=true は今日使える分類(有効期間内)だけに絞る。
      scope = scope.active_on if params[:active] == "true"
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_kana])
      end

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:category_code))
    end

    def create
      record = Master::MealCategory.new(record_params)
      record.category_code = next_category_code if record.category_code.blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    # 外部キーを張っていないので、参照している食種の分類を外してから消す。
    # 分類を消しただけで食種まで消えてしまうと事故になるため、食種は残して
    # 未分類(category_code = NULL)に戻す。
    def destroy
      code = @record.category_code
      Master::MealCategory.transaction do
        Master::MealDiet.where(category_code: code).update_all(category_code: nil)
        @record.destroy!
      end
      head :no_content
    end

    private

    # 数字だけの分類コードの最大値の次を2桁ゼロ埋めで。手入力の英字混じりコードは
    # 無視する。数件にしかならないマスタなので、項目マスタの6桁ではなく2桁。
    def next_category_code
      max = Master::MealCategory.where("category_code ~ '^[0-9]+$'")
                                .maximum(Arel.sql("category_code::bigint"))
      ((max || 0) + 1).to_s.rjust(2, "0")
    end

    def set_record
      # id ではなく分類コードでも引けるようにする。
      @record = Master::MealCategory.find_by(category_code: params[:id]) ||
                Master::MealCategory.find(params[:id])
    end
  end
end
