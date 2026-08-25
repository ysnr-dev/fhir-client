module Master
  # 処置オーダー項目のメンテナンス。画面から手動で登録する。
  # 生理検査の PhysioItemsController から検査種別(分類軸)と既定テンプレートの
  # 扱いを落としたもの。
  class TreatmentItemsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::TreatmentItem.all
      # カンマ区切りで複数指定可(保存済みのオーダーから項目情報を一括復元するため)。
      scope = scope.where(item_code: params[:item_code].split(",")) if params[:item_code].present?
      scope = scope.where(kind: params[:kind]) if params[:kind].present?
      # オーダー単位(groupable=true グループ化 / false 単独)での絞り込み。
      scope = scope.where(groupable: params[:groupable] == "true") if params[:groupable].present?
      # active=true は今日オーダーできる項目(有効期間内)だけに絞る。
      if params[:active] == "true"
        scope = scope
          .where("valid_from IS NULL OR valid_from <= ?", Date.current)
          .where("valid_to IS NULL OR valid_to >= ?", Date.current)
      end
      # 名称検索。keyword は「その場で項目を足す検索欄」用で、生理検査では検査種別も
      # 当てていたが処置には分類軸が無いので当てる先は名称・略称・カナだけ。
      query = params[:name].presence || params[:keyword].presence
      scope = flexible_name_match(scope, query, ITEM_SEARCH_COLUMNS) if query

      render json: paginate(with_receipt_name(scope).order(Arel.sql("display_order NULLS LAST")))
    end

    # セット構成・実施入力用データセットの名称をまとめて返す。
    # 詳細画面が1リクエストで開けるようにする。
    def show
      render json: @record.as_json.merge(
        set_items: set_items_for(@record.item_code).as_json,
        dataset_name: dataset_name_for(@record.dataset_code),
        receipt_procedure_name: receipt_procedure_name_for(@record.receipt_code)
      )
    end

    def create
      record = Master::TreatmentItem.new(record_params)
      record.item_code = next_item_code if record.item_code.blank?
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    # 外部キーを張っていないので、ぶら下がるセット構成も併せて片付ける
    # (データセットは項目の列で参照しているだけなので、本体は消さない)。
    def destroy
      code = @record.item_code
      Master::TreatmentItem.transaction do
        Master::TreatmentSetItem.where(set_item_code: code).delete_all
        Master::TreatmentSetItem.where(member_item_code: code).delete_all
        @record.destroy!
      end
      head :no_content
    end

    private

    # 名称検索の対象列。JOIN 先(master_medical_procedures)にも同名の列があるため、
    # 必ずテーブル名つきで指定する。
    ITEM_SEARCH_COLUMNS = %w[
      master_treatment_items.search_name
      master_treatment_items.search_short_name
      master_treatment_items.search_kana
    ].freeze

    # レセ電算 診療行為コードの名称を添える。一覧でコードだけが並んでも
    # 何の手技を指しているか分からないため(未取込・廃止コードでも出せるよう外部結合)。
    def with_receipt_name(scope)
      scope
        .joins("LEFT JOIN master_medical_procedures " \
               "ON master_medical_procedures.procedure_code = master_treatment_items.receipt_code")
        .select("master_treatment_items.*",
                "master_medical_procedures.name AS receipt_procedure_name")
    end

    def set_items_for(code)
      Master::TreatmentSetItem
        .where(set_item_code: code)
        .joins("LEFT JOIN master_treatment_items " \
               "ON master_treatment_items.item_code = master_treatment_set_items.member_item_code")
        .select(
          "master_treatment_set_items.*",
          "master_treatment_items.name AS member_name",
          "master_treatment_items.short_name AS member_short_name",
        )
        .order(Arel.sql("master_treatment_set_items.display_order NULLS LAST"))
        .order(:id)
    end

    # 参照している実施入力用データセットの名称。詳細画面が選択中の名前を出すのに使う。
    def dataset_name_for(code)
      return nil if code.blank?

      Master::TreatmentDataset.where(dataset_code: code).pick(:name)
    end

    def receipt_procedure_name_for(code)
      return nil if code.blank?

      Master::MedicalProcedure.where(procedure_code: code).pick(:name)
    end

    # 数字だけの項目コードの最大値の次。手入力の英字混じりコードは無視する。
    def next_item_code
      max = Master::TreatmentItem.where("item_code ~ '^[0-9]+$'")
                                 .maximum(Arel.sql("item_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      # id ではなく項目コードでも引けるようにする。
      @record = Master::TreatmentItem.find_by(item_code: params[:id]) ||
                Master::TreatmentItem.find(params[:id])
    end

    def record_params
      params.permit(Master::TreatmentItem.column_names - %w[id created_at updated_at])
    end
  end
end
