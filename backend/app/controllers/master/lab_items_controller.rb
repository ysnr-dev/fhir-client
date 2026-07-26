module Master
  class LabItemsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::LabItem.all
      # カンマ区切りで複数指定可(検査結果編集画面が保存済みコードからマスタ情報を一括復元するため)。
      scope = scope.where(jlac11_code: params[:jlac11_code].split(",")) if params[:jlac11_code].present?
      scope = scope.where(jlac10_code: params[:jlac10_code]) if params[:jlac10_code].present?
      scope = scope.where(category_name: params[:category_name]) if params[:category_name].present?
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_abbreviation])
      end

      # マスタ収載の標準表示順で並べる(paginate が :id を追加するので同順位内は収載順)。
      # display_order は "100"〜"9200" のゼロ埋めされていない数字文字列で 3〜4 桁が
      # 混在するため、文字列順では 100 < 1000 < 200 になってしまう。LPAD で桁を
      # 揃えて数値順にする(整数キャストは非数値が混入したマスタで SQL エラーになる)。
      scope = scope.order(Arel.sql("LPAD(display_order, 8, '0')"))

      render json: paginate(scope)
    end

    # 区分名称フィルタ用の選択肢(マスタ収載順の distinct な区分名称)。
    def categories
      names = Master::LabItem
        .where.not(category_name: [nil, ""])
        .group(:category_name)
        .minimum(:id)
        .sort_by { |_name, id| id }
        .map(&:first)
      render json: { category_names: names }
    end

    def show
      render json: @record
    end

    def create
      record = Master::LabItem.new(record_params)
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

      result = MasterImport::LabItemImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end

    private

    def set_record
      @record = Master::LabItem.find(params[:id])
    end

    def record_params
      params.permit(Master::LabItem.column_names - %w[id created_at updated_at])
    end
  end
end
