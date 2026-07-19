module Master
  class MedicinesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::Medicine.all
      scope = scope.where(medicine_code: params[:medicine_code]) if params[:medicine_code].present?
      scope = scope.where(yakka_code: params[:yakka_code]) if params[:yakka_code].present?
      scope = scope.where("name ILIKE ?", "%#{sanitize_like(params[:name])}%") if params[:name].present?

      render json: paginate(scope)
    end

    def show
      render json: @record
    end

    def create
      record = Master::Medicine.new(record_params)
      if record.save
        render json: record, status: :created
      else
        render json: { errors: record.errors.full_messages }, status: :unprocessable_entity
      end
    end

    def update
      if @record.update(record_params)
        render json: @record
      else
        render json: { errors: @record.errors.full_messages }, status: :unprocessable_entity
      end
    end

    def destroy
      @record.destroy!
      head :no_content
    end

    def import
      return render json: { error: "file is required" }, status: :unprocessable_entity if params[:file].blank?

      result = MasterImport::MedicineImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end

    private

    def set_record
      @record = Master::Medicine.find(params[:id])
    end

    def record_params
      params.permit(Master::Medicine.column_names - %w[id created_at updated_at])
    end
  end
end
