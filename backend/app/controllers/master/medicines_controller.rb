module Master
  class MedicinesController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = medicines_with_type
      scope = scope.where(medicine_code: params[:medicine_code]) if params[:medicine_code].present?
      scope = scope.where(yakka_code: params[:yakka_code]) if params[:yakka_code].present?
      # 剤形区分(1:内用薬、4:注射薬、6:外用薬、8:歯科用薬剤)。注射オーダーの医薬品検索で使う。
      scope = scope.where(dosage_form: params[:dosage_form]) if params[:dosage_form].present?
      # JOIN 後は master_medicine_types にも search_name があるためテーブル修飾で曖昧さを回避する。
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name],
                                    %w[master_medicines.search_name master_medicines.search_kana master_medicines.search_generic])
      end
      # 薬効分類は YJコード(yakka_code)の上4桁。code 完全一致 / 名称検索の2通りで絞り込む。
      scope = scope.where("LEFT(master_medicines.yakka_code, 4) = ?", params[:yakko_code]) if params[:yakko_code].present?
      scope = filter_by_yakko_name(scope, params[:yakko_name]) if params[:yakko_name].present?

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

      result = MasterImport::MedicineImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end

    private

    # 薬効分類名称(yakko_name)と薬効分類番号(yakko_code=YJ上4桁)を各医薬品に付与する。
    # master_medicine_types.code は一意なので LEFT JOIN で件数は増えない。
    # yj_code(個別医薬品コード)は医薬品マスタに無いため、HOTコードマスタを
    # レセプト電算コード(medicine_code = receipt_code_1)で引く相関サブクエリで付与する。
    # 1件に複数の包装(HOT行)が対応しうるが個別医薬品コードは同一なので LIMIT 1 でよく、
    # JOIN と違い件数(paginate の COUNT)を増やさない。
    def medicines_with_type
      Master::Medicine
        .joins("LEFT JOIN master_medicine_types ON master_medicine_types.code = LEFT(master_medicines.yakka_code, 4)")
        .select(
          "master_medicines.*",
          "LEFT(master_medicines.yakka_code, 4) AS yakko_code",
          "master_medicine_types.name AS yakko_name",
          "(SELECT hc.individual_medicine_code FROM master_hot_codes hc " \
          "WHERE hc.receipt_code_1 = master_medicines.medicine_code " \
          "AND hc.individual_medicine_code <> '' LIMIT 1) AS yj_code",
        )
    end

    # 薬効分類名称での絞り込み。名称を表記ゆれ吸収検索で該当コードに解決し、
    # その薬効分類番号(4桁)を持つ医薬品に絞る。
    def filter_by_yakko_name(scope, query)
      codes = flexible_name_match(Master::MedicineType.all, query, %w[search_name]).pluck(:code)
      return scope.none if codes.empty?

      scope.where("LEFT(master_medicines.yakka_code, 4) IN (?)", codes)
    end

    def set_record
      @record = Master::Medicine.find(params[:id])
    end

    def record_params
      params.permit(Master::Medicine.column_names - %w[id created_at updated_at])
    end
  end
end
