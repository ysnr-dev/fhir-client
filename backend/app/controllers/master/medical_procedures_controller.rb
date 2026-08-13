module Master
  # 医科診療行為マスタ。配布ファイルの全置換取込と、実施入力の手技検索のための
  # 一覧を持つ。手動メンテはしないので create/update/destroy は無い。
  class MedicalProceduresController < BaseController
    def index
      scope = Master::MedicalProcedure.all
      # カンマ区切りで複数指定可(保存済みの実施情報から手技名を一括復元するため)。
      scope = scope.where(procedure_code: params[:procedure_code].split(",")) if params[:procedure_code].present?
      # コード表用番号のアルファベット部。点数表の章にあたり、放射線(画像診断)は E。
      if params[:code_table_number_alpha].present?
        scope = scope.where(code_table_number_alpha: params[:code_table_number_alpha])
      end
      # active=true は廃止されていないものだけ(実施入力の検索はこちらを使う)。
      scope = scope.active if params[:active] == "true"
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_kana])
      end

      render json: paginate(scope.order(Arel.sql("publication_order NULLS LAST")).order(:procedure_code))
    end

    def import
      return render json: { error: "file is required" }, status: :unprocessable_content if params[:file].blank?

      result = MasterImport::MedicalProcedureImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end
  end
end
