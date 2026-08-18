module LabLabels
  # 発行・到着状況の照会。検体検査一覧・到着確認画面の表示用。
  class RecordsController < BaseController
    # GET /lab_labels?order_ids=a,b,c
    # 表示中のオーダーの状況をまとめて引くための形(カンマ区切りの複数指定)。
    def index
      order_ids = params[:order_ids].to_s.split(",").map(&:strip).reject(&:empty?)
      records =
        if order_ids.empty?
          LabLabelRecord.none
        else
          LabLabelRecord.where(order_fhir_id: order_ids).order(:id)
        end
      render json: { items: records.map { |record| record_json(record) } }
    end
  end
end
