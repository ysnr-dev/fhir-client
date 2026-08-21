module Master
  # マスタ取込エンドポイント共通の import アクション。importer は規約
  # (medicines → MasterImport::MedicineImporter)で引く。
  module Importable
    def import
      return render json: { error: "file is required" }, status: :unprocessable_content if params[:file].blank?

      result = importer_class.call(params[:file])
      render json: import_result_json(result)
    end

    private

    def importer_class
      "MasterImport::#{controller_name.classify}Importer".constantize
    end

    # 追加の件数(skipped 等)も返すコントローラはここをオーバーライドする。
    def import_result_json(result)
      { imported: result.imported_count }
    end
  end
end
