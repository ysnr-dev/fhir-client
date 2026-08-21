module Master
  # Plain JSON REST base for the master-data endpoints (HOT code / medicine /
  # medicine usage). Intentionally separate from ApplicationController: these
  # are domestic reference tables, not FHIR resources, so they don't use
  # OperationOutcome or FHIR content types.
  class BaseController < ActionController::API
    # アプリ本体のログイン認証(ADMIN_TOKEN 未設定なら従来どおり認証なし)。
    include UserAuthentication

    before_action :authorize_user!
    before_action :verify_user_csrf!

    rescue_from ActiveRecord::RecordNotFound, with: :render_not_found
    rescue_from MasterImport::ImportError, with: :render_import_error

    # --- 標準 CRUD -----------------------------------------------------------
    # 各マスタ共通の素朴な CRUD。index は絞り込みがマスタごとに違うため共通化
    # しない。挙動を変えたいコントローラは該当アクションだけオーバーライドする。
    # set_record を使うアクションは、各コントローラの
    # `before_action :set_record, only: ...` で従来どおり配線する。

    def show
      render json: @record
    end

    def create
      record = model_class.new(record_params)
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    def update
      if @record.update(record_params)
        render json: @record
      else
        render_validation_errors(@record)
      end
    end

    def destroy
      @record.destroy!
      head :no_content
    end

    private

    # 規約: コントローラ名からモデルを引く(medicines → Master::Medicine)。
    def model_class
      "Master::#{controller_name.classify}".constantize
    end

    def set_record
      @record = model_class.find(params[:id])
    end

    def record_params
      params.permit(model_class.column_names - %w[id created_at updated_at])
    end

    def render_validation_errors(record)
      render json: { errors: record.errors.full_messages }, status: :unprocessable_content
    end

    def render_not_found
      render json: { error: "not_found" }, status: :not_found
    end

    def render_import_error(exception)
      render json: { error: exception.message }, status: :unprocessable_content
    end

    def pagination_params
      page = params[:page].presence&.to_i || 1
      page = 1 if page < 1
      per = params[:per].presence&.to_i || 20
      per = per.clamp(1, 100)
      [page, per]
    end

    def paginate(scope)
      page, per = pagination_params
      # カスタム select（例: 医薬品検索の yakko_name JOIN）を含む relation でも
      # COUNT(*) になるよう count(:all) を使う。
      total = scope.count(:all)
      items = scope.order(:id).limit(per).offset((page - 1) * per)

      { total: total, page: page, per: per, items: items }
    end

    def sanitize_like(str)
      str.gsub(/[%_\\]/) { |c| "\\#{c}" }
    end

    # 病名・修飾語マスタ用の名称検索。flexible_name_match と同じ表記ゆれ検索に
    # 加えて、病名索引テーブルの索引用語(同義語・異字体・読みなど)にヒットした
    # 交換用コードのレコードも結果に含める。
    # index_category: 索引テーブルの病名修飾語区分("1"=病名, "2"=修飾語)
    def flexible_name_or_index_match(scope, query, index_category)
      conn = ActiveRecord::Base.connection
      whole = conn.quote("%#{sanitize_like(Master::SearchNormalizer.normalize(query))}%")

      name_clauses = Master::SearchNormalizer.tokenize(query).map do |token|
        pattern = conn.quote("%#{sanitize_like(token)}%")
        "(search_name LIKE #{pattern} OR search_kana LIKE #{pattern})"
      end
      name_sql = name_clauses.presence&.join(" AND ") || "FALSE"

      index_sql = "exchange_code IN (SELECT target_code FROM master_disease_indexes " \
                  "WHERE disease_modifier_category = #{conn.quote(index_category)} " \
                  "AND search_term LIKE #{whole})"

      scope
        .where("(#{name_sql}) OR (#{index_sql})")
        .order(Arel.sql("(search_name LIKE #{whole} OR search_kana LIKE #{whole}) DESC NULLS LAST"))
    end

    # 表記ゆれを吸収した名称検索。クエリを正規化トークンに分割し、全トークンが
    # いずれかの検索用カラムに含まれる(AND)レコードに絞り込む。正規化後の
    # クエリ全体が連続一致するレコードを先頭に並べる。
    def flexible_name_match(scope, query, columns)
      Master::SearchNormalizer.tokenize(query).each do |token|
        clause = columns.map { |c| "#{c} LIKE :pattern" }.join(" OR ")
        scope = scope.where(clause, pattern: "%#{sanitize_like(token)}%")
      end

      whole = "%#{sanitize_like(Master::SearchNormalizer.normalize(query))}%"
      exact = columns.map { |c| "#{c} LIKE #{ActiveRecord::Base.connection.quote(whole)}" }.join(" OR ")
      scope.order(Arel.sql("(#{exact}) DESC NULLS LAST"))
    end
  end
end
