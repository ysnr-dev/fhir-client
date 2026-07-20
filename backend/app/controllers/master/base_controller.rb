module Master
  # Plain JSON REST base for the master-data endpoints (HOT code / medicine /
  # medicine usage). Intentionally separate from ApplicationController: these
  # are domestic reference tables, not FHIR resources, so they don't use
  # OperationOutcome or FHIR content types.
  class BaseController < ActionController::API
    rescue_from ActiveRecord::RecordNotFound, with: :render_not_found
    rescue_from MasterImport::ImportError, with: :render_import_error

    private

    def render_not_found
      render json: { error: "not_found" }, status: :not_found
    end

    def render_import_error(exception)
      render json: { error: exception.message }, status: :unprocessable_entity
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
