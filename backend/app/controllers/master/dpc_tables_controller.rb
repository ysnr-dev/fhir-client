module Master
  # DPC 電子点数表。取込(全シート、版ごとに入れ替え)と、取り込んだ版の一覧。
  class DpcTablesController < BaseController
    include Importable

    def index
      editions = Master::DpcEdition.order(edition: :desc)
      render json: { items: editions.as_json(only: %i[edition source_filename counts imported_at]) }
    end

    private

    def import_result_json(result)
      { imported: result.imported_count, elements: result.elements }
    end
  end
end
