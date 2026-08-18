module LabLabels
  # 検体到着の記録。到着確認画面のスキャンが叩く。
  class ArrivalsController < BaseController
    # POST /lab_labels/arrivals {label_number}
    # 冪等: 既に到着済みの番号は上書きせず、元の記録と already_arrived を返す
    # (二重スキャンは日常操作なのでエラーにしない)。
    def create
      number = params[:label_number].to_s
      unless LabLabelRecord.valid_number?(number)
        return render json: { error: "invalid_number" }, status: :unprocessable_content
      end

      record = LabLabelRecord.find_by(label_number: number)
      return render json: { error: "unknown_number" }, status: :not_found unless record

      already = record.arrived_at.present?
      record.update!(arrived_at: Time.current, arrived_by: current_user&.login_id) unless already
      render json: record_json(record).merge(already_arrived: already)
    end

    # DELETE /lab_labels/arrivals/:label_number
    # 誤スキャンの取消。到着の事実そのものを消す(取り消した記録は残さない)。
    def destroy
      record = LabLabelRecord.find_by!(label_number: params[:label_number])
      record.update!(arrived_at: nil, arrived_by: nil)
      render json: record_json(record)
    end
  end
end
