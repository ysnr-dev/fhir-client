module Master
  # 検体検査結果の取込(JAHIS 臨床検査データ交換規約 / HL7 v2.5)。
  #
  # 施設の参照表ではなく現場の作業キューだが、ログイン認証・CSRF・エラー整形を
  # /master の基底と共有するためここに置く(オーダーセットと同じ理由)。
  # 上流 FHIR への登録は取込画面が既存の結果登録経路で行い、backend は台帳まで。
  class LabResultImportsController < BaseController
    before_action :set_record, only: %i[show destroy resolve]

    def index
      result = paginate(LabResultImport.recent)
      counts = LabResultImport.status_counts_for(result[:items].map(&:id))
      render json: result.merge(items: result[:items].map { |import| summary(import, counts) })
    end

    def show
      render json: summary(@record)
        .merge("rows" => @record.rows.ordered.as_json, "duplicate_ids" => duplicate_ids(@record))
    end

    def create
      return render json: { error: "file is required" }, status: :unprocessable_content if params[:file].blank?

      file = params[:file]
      result = LabImport::Importer.new(
        file: file,
        file_name: file.try(:original_filename),
        format: params[:format],
        encoding: params[:encoding],
        imported_by: imported_by
      ).call

      render json: { import: summary(result.import), duplicate_ids: result.duplicate_ids },
             status: :created
    end

    # 結果項目マスタに JLAC を足した後の再引き当て。人が手で選んだ行(manual)は
    # 上書きしない。
    def resolve
      # resolution が NULL の行(まだ一度も当たっていない行)も対象にする。
      # SQL の <> は NULL を真にしないため where.not では拾えない。
      rows = @record.rows.pending
                    .where("resolution IS NULL OR resolution <> ?", "manual").to_a
      LabImport::ItemResolver.new.resolve_all(rows)
      rows.each(&:save!)
      render json: { resolved: rows.count { |row| row.status == "ready" }, rows: rows.as_json }
    end

    def destroy
      # 登録済みの行が混ざっていても消せる。台帳は作業キューで、登録した結果は上流にある。
      @record.destroy!
      head :no_content
    end

    private

    def model_class = LabResultImport

    def imported_by
      payload = current_user_payload
      return {} if payload.nil?

      { login_id: payload[:login_id], practitioner_id: payload[:practitioner_id] }
    end

    # 同じメッセージ ID の他のバッチ。訂正版が同じ ID で来ることがあるので取込は
    # 止めず、画面で気付けるようにするだけ。
    def duplicate_ids(import)
      return [] if import.message_control_id.blank?

      LabResultImport.where(message_control_id: import.message_control_id)
                     .where.not(id: import.id).order(:id).pluck(:id)
    end

    def summary(import, counts = nil)
      status_counts = counts ? (counts[import.id] || {}) : import.status_counts
      import.as_json.merge("status_counts" => status_counts)
    end
  end
end
