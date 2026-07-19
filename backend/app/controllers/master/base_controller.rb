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
      total = scope.count
      items = scope.order(:id).limit(per).offset((page - 1) * per)

      { total: total, page: page, per: per, items: items }
    end

    def sanitize_like(str)
      str.gsub(/[%_\\]/) { |c| "\\#{c}" }
    end
  end
end
