module Master
  # 術式マスタのメンテナンス。画面から手動で登録する。
  # 処置の TreatmentItemsController からセット・データセット・予約の扱いを落とし、
  # 申込フォームの既定値列を足したもの。
  class SurgeryItemsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::SurgeryItem.all
      # カンマ区切りで複数指定可(保存済みのオーダーから項目情報を一括復元するため)。
      scope = scope.where(item_code: params[:item_code].split(",")) if params[:item_code].present?
      # 種別(分類)。入れ子なので、上位の分類を指定したら配下の分類の術式も出す
      # (「腹部」で絞ったら「胃、食道、腸、他」の術式も並ぶ)。
      if params[:category_code].present?
        scope = scope.where(category_code: Master::SurgeryCategory.subtree_codes(params[:category_code]))
      end
      # active=true は今日オーダーできる項目(有効期間内)だけに絞る。
      if params[:active] == "true"
        scope = scope
          .where("valid_from IS NULL OR valid_from <= ?", Date.current)
          .where("valid_to IS NULL OR valid_to >= ?", Date.current)
      end
      # 名称検索。当てる先は名称・略称・カナ(処置と同じ)。
      query = params[:name].presence || params[:keyword].presence
      scope = flexible_name_match(scope, query, ITEM_SEARCH_COLUMNS) if query

      render json: paginate(with_receipt_name(scope).order(Arel.sql("display_order NULLS LAST")))
    end

    def show
      render json: @record.as_json.merge(
        receipt_procedure_name: receipt_procedure_name_for(@record.receipt_code)
      )
    end

    def create
      record = Master::SurgeryItem.new(record_params)
      record.item_code = next_item_code if record.item_code.blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    def destroy
      @record.destroy!
      head :no_content
    end

    private

    # 名称検索の対象列。JOIN 先(master_medical_procedures)にも同名の列があるため、
    # 必ずテーブル名つきで指定する。
    ITEM_SEARCH_COLUMNS = %w[
      master_surgery_items.search_name
      master_surgery_items.search_short_name
      master_surgery_items.search_kana
    ].freeze

    # レセ電算 診療行為コード(K章)の名称を添える。一覧でコードだけが並んでも
    # 何の術式を指しているか分からないため(未取込・廃止コードでも出せるよう外部結合)。
    def with_receipt_name(scope)
      scope
        .joins("LEFT JOIN master_medical_procedures " \
               "ON master_medical_procedures.procedure_code = master_surgery_items.receipt_code")
        .select("master_surgery_items.*",
                "master_medical_procedures.name AS receipt_procedure_name")
    end

    def receipt_procedure_name_for(code)
      return nil if code.blank?

      Master::MedicalProcedure.where(procedure_code: code).pick(:name)
    end

    # 数字だけの項目コードの最大値の次。手入力の英字混じりコードは無視する。
    def next_item_code
      max = Master::SurgeryItem.where("item_code ~ '^[0-9]+$'")
                               .maximum(Arel.sql("item_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      # id ではなく項目コードでも引けるようにする。
      @record = Master::SurgeryItem.find_by(item_code: params[:id]) ||
                Master::SurgeryItem.find(params[:id])
    end

    def record_params
      params.permit(Master::SurgeryItem.column_names - %w[id created_at updated_at])
    end
  end
end
