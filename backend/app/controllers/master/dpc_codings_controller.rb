module Master
  # 入院 1 件の診断群分類(14 桁)の判定。様式1 の値と人の上書きを受け、入院期間の実施記録と
  # 合わせて判定した結果を返す。副作用は無い(決定の記録は画面が上流に書く)。
  class DpcCodingsController < BaseController
    rescue_from ::Dpc::Coding::NotFound do
      render json: { error: "encounter_not_found" }, status: :not_found
    end

    rescue_from Integrations::FhirStore::UpstreamError do
      render json: { error: "upstream_unreachable" }, status: :bad_gateway
    end

    # POST /master/dpc/coding { encounter_id, inputs: {...}, overrides: {...} }
    def create
      return render json: { error: "encounter_id is required" }, status: :unprocessable_content if params[:encounter_id].blank?

      result = ::Dpc::Coding.new(
        encounter_id: params[:encounter_id].to_s,
        inputs: params[:inputs]&.permit!&.to_h,
        overrides: params[:overrides]&.permit!&.to_h
      ).call
      render json: result
    end
  end
end
