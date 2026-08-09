module Master
  # 検体(材料)マスタのメンテナンス。JLAC11 の材料コード一覧から取り込み、
  # 略称・既定採取管などの手入力列を画面で整備する。
  class LabSpecimensController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::LabSpecimen.all
      # カンマ区切りで複数指定可(オーダー項目一覧が検体名を一括解決するため)。
      if params[:specimen_code].present?
        scope = scope.where(specimen_code: params[:specimen_code].split(","))
      end
      scope = scope.where(category: params[:category]) if params[:category].present?
      scope = scope.where(recommended: true) if params[:recommended] == "true"
      if params[:parent_specimen_code].present?
        scope = scope.where(parent_specimen_code: params[:parent_specimen_code])
      end
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_kana])
      end

      # 配布ファイルの掲載順(未設定は末尾)。
      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")))
    end

    # 検体分類の一覧(絞り込みプルダウン用)。配布ファイルの掲載順で返す。
    def categories
      list = Master::LabSpecimen
        .where.not(category: [nil, ""])
        .group(:category)
        .minimum(:display_order)
        .sort_by { |_category, order| order || 0 }
        .map(&:first)

      render json: list
    end

    def show
      render json: @record
    end

    def create
      record = Master::LabSpecimen.new(record_params)
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

    def import
      return render json: { error: "file is required" }, status: :unprocessable_content if params[:file].blank?

      result = MasterImport::LabSpecimenImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end

    private

    def set_record
      @record = Master::LabSpecimen.find(params[:id])
    end

    def record_params
      params.permit(Master::LabSpecimen.column_names - %w[id created_at updated_at])
    end
  end
end
