module Master
  # 検査種別のメンテナンスのアクション。配布マスタが無いので取込は持たず、画面から
  # 施設が自由に登録する。オーダー項目のモデルは名前の規約で引く(PhysioExamType → PhysioItem)。
  module ExamTypeActions
    extend ActiveSupport::Concern

    included do
      before_action :set_record, only: %i[show update destroy]
    end

    def index
      scope = model_class.all
      # カンマ区切りで複数指定可(項目一覧が載っている種別の名称をまとめて引くため)。
      if params[:exam_type_code].present?
        scope = scope.where(exam_type_code: params[:exam_type_code].split(","))
      end
      # active=true は今日使える種別(有効期間内)だけに絞る。
      scope = scope.active_on if params[:active] == "true"
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_short_name search_kana])
      end

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:exam_type_code))
    end

    def create
      record = model_class.new(record_params)
      record.exam_type_code = next_exam_type_code if record.exam_type_code.blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    # 外部キーを張っていないので、参照しているオーダー項目の種別を外してから消す。
    # 種別を消しただけで項目まで消えてしまうと事故になるため、項目は残して
    # 未分類(exam_type_code = NULL)に戻す。
    def destroy
      code = @record.exam_type_code
      model_class.transaction do
        item_model.where(exam_type_code: code).update_all(exam_type_code: nil)
        @record.destroy!
      end
      head :no_content
    end

    private

    def item_model
      "#{model_class.name.delete_suffix('ExamType')}Item".constantize
    end

    # 数字だけの種別コードの最大値の次を2桁ゼロ埋めで。手入力の英字混じりコードは
    # 無視する。10件前後にしかならないマスタなので、他マスタの6桁ではなく2桁。
    def next_exam_type_code
      max = model_class.where("exam_type_code ~ '^[0-9]+$'").maximum(Arel.sql("exam_type_code::bigint"))
      ((max || 0) + 1).to_s.rjust(2, "0")
    end

    def set_record
      # id ではなく種別コードでも引けるようにする。
      @record = model_class.find_by(exam_type_code: params[:id]) || model_class.find(params[:id])
    end
  end
end
