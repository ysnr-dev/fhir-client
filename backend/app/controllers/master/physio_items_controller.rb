module Master
  # 生理検査オーダー項目のメンテナンス。画面から手動で登録する。
  # 放射線の RadItemsController から JJ1017 の要素解決と頻用コードからの一括作成を
  # 落とし、代わりに検査種別(master_physio_exam_types)の名称を添える。
  class PhysioItemsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::PhysioItem.all
      # カンマ区切りで複数指定可(保存済みのオーダーから項目情報を一括復元するため)。
      scope = scope.where(item_code: params[:item_code].split(",")) if params[:item_code].present?
      scope = scope.where(kind: params[:kind]) if params[:kind].present?
      # オーダー単位(groupable=true グループ化 / false 単独)での絞り込み。
      scope = scope.where(groupable: params[:groupable] == "true") if params[:groupable].present?
      scope = scope.where(exam_type_code: params[:exam_type_code]) if params[:exam_type_code].present?
      # active=true は今日オーダーできる項目(有効期間内)だけに絞る。
      if params[:active] == "true"
        scope = scope
          .where("valid_from IS NULL OR valid_from <= ?", Date.current)
          .where("valid_to IS NULL OR valid_to >= ?", Date.current)
      end
      if params[:name].present?
        # レセ電算名称の LEFT JOIN(with_receipt_name)先も search_name を持つので、
        # 列名は必ずテーブル名で限定する。
        scope = flexible_name_match(scope, params[:name], ITEM_SEARCH_COLUMNS)
      end
      # 名称・検査種別を1つの語でまとめて探す(その場で項目を足す検索欄用)。
      scope = keyword_match(scope, params[:keyword]) if params[:keyword].present?

      result = paginate(with_receipt_name(scope).order(Arel.sql("display_order NULLS LAST")))
      # 一覧でも検査種別の名称を出したいので、載っている種別をまとめて引いて添える。
      render json: result.merge(exam_types: exam_type_names_for(result[:items]))
    end

    # 検査種別の名称・セット構成・実施入力用データセットの名称をまとめて返す。
    # 詳細画面が1リクエストで開けるようにする。
    def show
      set_items = set_items_for(@record.item_code).to_a
      # 構成項目の検査種別も画面に出すため、名称の解決にはセットに載っている
      # 項目そのものも含める。
      members = Master::PhysioItem.where(item_code: set_items.map(&:member_item_code)).to_a
      render json: @record.as_json.merge(
        exam_types: exam_type_names_for([@record, *members]),
        set_items: set_items.as_json,
        dataset_name: dataset_name_for(@record.dataset_code),
        receipt_procedure_name: receipt_procedure_name_for(@record.receipt_code)
      )
    end

    def create
      record = Master::PhysioItem.new(record_params)
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
      Master::PhysioItem.transaction do
        Master::PhysioSetItem.where(set_item_code: code).delete_all
        Master::PhysioSetItem.where(member_item_code: code).delete_all
        @record.destroy!
      end
      head :no_content
    end

    private

    # 名称検索の対象列。JOIN 先(master_medical_procedures)にも同名の列があるため、
    # 必ずテーブル名つきで指定する。
    ITEM_SEARCH_COLUMNS = %w[
      master_physio_items.search_name
      master_physio_items.search_short_name
      master_physio_items.search_kana
    ].freeze

    # 名称・略称・カナに加えて、検査種別の名称にも当てる(「超音波」で腹部エコーを
    # 引けるように)。種別の名称は検査種別マスタにしか無いので、その語に当たる
    # コードを引いて照合する。表記ゆれの吸収は双方の search_name(正規化済み)に任せる。
    def keyword_match(scope, query)
      conn = ActiveRecord::Base.connection

      Master::SearchNormalizer.tokenize(query).each do |token|
        pattern = conn.quote("%#{sanitize_like(token)}%")
        clauses = %w[search_name search_short_name search_kana].map do |column|
          "master_physio_items.#{column} LIKE #{pattern}"
        end
        clauses << "master_physio_items.exam_type_code IN " \
                   "(SELECT exam_type_code FROM master_physio_exam_types " \
                   "WHERE search_name LIKE #{pattern} OR search_short_name LIKE #{pattern} " \
                   "OR search_kana LIKE #{pattern})"
        scope = scope.where(clauses.join(" OR "))
      end

      scope
    end

    # レセ電算 診療行為コードの名称を添える。一覧でコードだけが並んでも
    # 何の手技を指しているか分からないため(未取込・廃止コードでも出せるよう外部結合)。
    def with_receipt_name(scope)
      scope
        .joins("LEFT JOIN master_medical_procedures " \
               "ON master_medical_procedures.procedure_code = master_physio_items.receipt_code")
        .select("master_physio_items.*",
                "master_medical_procedures.name AS receipt_procedure_name")
    end

    # 項目に載っている検査種別を {コード => 名称} で引く。
    # 外部キーが無いぶん、画面が名称を出すのに必要な分だけをここで解決する。
    def exam_type_names_for(items)
      codes = items.filter_map { |item| item[:exam_type_code].presence }.uniq
      return {} if codes.empty?

      Master::PhysioExamType.where(exam_type_code: codes).pluck(:exam_type_code, :name).to_h
    end

    def set_items_for(code)
      Master::PhysioSetItem
        .where(set_item_code: code)
        .joins("LEFT JOIN master_physio_items " \
               "ON master_physio_items.item_code = master_physio_set_items.member_item_code")
        .select(
          "master_physio_set_items.*",
          "master_physio_items.name AS member_name",
          "master_physio_items.short_name AS member_short_name",
          "master_physio_items.exam_type_code AS member_exam_type_code",
        )
        .order(Arel.sql("master_physio_set_items.display_order NULLS LAST"))
        .order(:id)
    end

    # 参照している実施入力用データセットの名称。詳細画面が選択中の名前を出すのに使う。
    def dataset_name_for(code)
      return nil if code.blank?

      Master::PhysioDataset.where(dataset_code: code).pick(:name)
    end

    def receipt_procedure_name_for(code)
      return nil if code.blank?

      Master::MedicalProcedure.where(procedure_code: code).pick(:name)
    end

    # 数字だけの項目コードの最大値の次。手入力の英字混じりコードは無視する。
    def next_item_code
      max = Master::PhysioItem.where("item_code ~ '^[0-9]+$'").maximum(Arel.sql("item_code::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    def set_record
      # id ではなく項目コードでも引けるようにする。
      @record = Master::PhysioItem.find_by(item_code: params[:id]) || Master::PhysioItem.find(params[:id])
    end

    def record_params
      params.permit(Master::PhysioItem.column_names - %w[id created_at updated_at])
    end
  end
end
