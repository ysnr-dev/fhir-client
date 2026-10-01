module Reports
  # DPC 様式1 の提出ファイル(FF1)。対象月に退院した入院の様式1 を集める。
  class DpcForm1Controller < BaseController
    rescue_from DpcForm1Export::InvalidMonth do
      render json: { error: "invalid_month" }, status: :unprocessable_content
    end

    rescue_from DpcForm1Export::NothingToExport do
      render json: { error: "no_exportable_form1" }, status: :unprocessable_content
    end

    rescue_from Integrations::FhirStore::UpstreamError do
      render json: { error: "upstream_unreachable" }, status: :bad_gateway
    end

    # GET /reports/dpc_form1?month=YYYY-MM
    # 対象入院の一覧(様式1 の状態つき)と警告。ファイルを作る前の確認に使う。
    def show
      render json: DpcForm1Export.new(month: params[:month]).summary
    end

    # GET /reports/dpc_form1/file?month=YYYY-MM
    # 確定済みの様式1 だけを並べた提出ファイル。文字コードは変換済みなのでバイト列のまま返す。
    def file
      export = DpcForm1Export.new(month: params[:month])
      send_data export.file,
                filename: export.filename,
                type: "text/plain",
                disposition: "attachment"
    end
  end
end
