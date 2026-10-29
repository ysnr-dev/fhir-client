module Master
  # 指導・管理料の項目のメンテナンス。画面から手動で登録する。
  class ManagementFeeItemsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::ManagementFeeItem.all
      # カンマ区切りで複数指定可(保存済みのオーダーから項目情報を一括復元するため)。
      scope = scope.where(item_code: params[:item_code].split(",")) if params[:item_code].present?
      scope = scope.active if params[:active] == "true"
      scope = scope.where(params[:setting] == "inpatient" ? { inpatient: true } : { outpatient: true }) if
        %w[inpatient outpatient].include?(params[:setting])
      scope = flexible_name_match(scope, params[:name], ITEM_SEARCH_COLUMNS) if params[:name].present?

      page = paginate(with_receipt_columns(scope).order(Arel.sql("display_order NULLS LAST")), max_per: 500)
      render json: page.merge(items: with_additions(page[:items]))
    end

    def show
      render json: with_additions([with_receipt_columns(Master::ManagementFeeItem.where(id: @record.id)).first]).first
    end

    def create
      record = Master::ManagementFeeItem.new(record_params)
      record.item_code = next_item_code if record.item_code.blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    private

    # JOIN 先(master_medical_procedures)にも同名の列があるため、テーブル名つきで指定する。
    ITEM_SEARCH_COLUMNS = %w[
      master_management_fee_items.search_name
      master_management_fee_items.search_kana
    ].freeze

    # 診療行為マスタの名称・点数・算定回数の上限を添える(未取込・廃止コードでも出せるよう外部結合)。
    def with_receipt_columns(scope)
      scope
        .joins("LEFT JOIN master_medical_procedures " \
               "ON master_medical_procedures.procedure_code = master_management_fee_items.receipt_code")
        .select("master_management_fee_items.*",
                "master_medical_procedures.name AS receipt_procedure_name",
                "master_medical_procedures.points AS receipt_points",
                "master_medical_procedures.max_times AS receipt_max_times")
    end

    # 加算コードを名称・点数つきに展開する。ページ内の加算をまとめて 1 回で引く。
    def with_additions(records)
      codes = records.flat_map(&:addition_codes).uniq
      procedures = Master::MedicalProcedure.where(procedure_code: codes)
                                           .pluck(:procedure_code, :name, :points)
                                           .to_h { |code, name, points| [code, { code: code, name: name, points: points }] }
      records.map do |record|
        record.as_json.merge(
          "additions" => record.addition_codes.map { |code| procedures[code] || { code: code, name: nil, points: nil } }
        )
      end
    end

    # 数字だけの項目コードの最大値の次。手入力の英字混じりコードは無視する。
    def next_item_code
      max = Master::ManagementFeeItem.where("item_code ~ '^[0-9]+$'")
                                     .maximum(Arel.sql("item_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      @record = Master::ManagementFeeItem.find_by(item_code: params[:id]) ||
                Master::ManagementFeeItem.find(params[:id])
    end

    def record_params
      params.permit(*(Master::ManagementFeeItem.column_names - %w[id addition_codes search_name search_kana
                                                                   created_at updated_at]),
                    addition_codes: [])
    end
  end
end
