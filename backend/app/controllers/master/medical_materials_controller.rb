module Master
  # 特定器材(特定保険医療材料)マスタ。配布ファイルの全置換取込と、実施入力の
  # 器材検索のための一覧を持つ。手動メンテはしないので create/update/destroy は無い。
  class MedicalMaterialsController < BaseController
    def index
      scope = Master::MedicalMaterial.all
      # カンマ区切りで複数指定可(保存済みの実施情報から器材名を一括復元するため)。
      scope = scope.where(material_code: params[:material_code].split(",")) if params[:material_code].present?
      # 特定器材種別。フィルムと材料など、用途で絞りたいときに使う。
      scope = scope.where(material_category: params[:material_category]) if params[:material_category].present?
      # active=true は廃止されていないものだけ(実施入力の検索はこちらを使う)。
      scope = scope.active if params[:active] == "true"
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_kana])
      end

      render json: paginate(scope.order(Arel.sql("publication_order NULLS LAST")).order(:material_code))
    end

    def import
      return render json: { error: "file is required" }, status: :unprocessable_content if params[:file].blank?

      result = MasterImport::MedicalMaterialImporter.call(params[:file])
      render json: { imported: result.imported_count }
    end
  end
end
