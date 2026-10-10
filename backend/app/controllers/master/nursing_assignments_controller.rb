module Master
  # 看護の業務分担(日・勤務帯ごとの受け持ち)。業務分担の画面が病棟 × 日でまとめて読み書きし、
  # 看護ワークシート・ホームが看護師 × 日で自分の受け持ちを引く。
  class NursingAssignmentsController < BaseController
    MAX_ITEMS_PER_REQUEST = 500

    # assigned_on は必須。ward_id(病棟の全勤務帯)か practitioner_id(その看護師の受け持ち)のどちらか。
    def index
      date = parse_date(params[:assigned_on])
      return render json: { errors: ["assigned_on を指定してください"] }, status: :unprocessable_content unless date

      scope = NursingAssignment.where(assigned_on: date)
      if params[:ward_id].present?
        scope = scope.where(ward_id: params[:ward_id])
      elsif params[:practitioner_id].present?
        scope = scope.where(practitioner_id: params[:practitioner_id])
      else
        return render json: { errors: ["ward_id か practitioner_id を指定してください"] }, status: :unprocessable_content
      end

      items = scope.order(:shift, :id).map { |a| detail(a) }
      render json: { total: items.size, items: items }
    end

    # 病棟 × 日の指定した勤務帯を items でまるごと置き換える。items に無い患者は受け持ちが外れる。
    # 同じ日・勤務帯で別の病棟に割り付けられていた患者(転棟)は、こちらの割り付けで置き換える。
    def replace
      ward_id = params[:ward_id].to_s
      date = parse_date(params[:assigned_on])
      shifts = Array(params[:shifts]).map(&:to_s)
      errors = []
      errors << "ward_id を指定してください" if ward_id.blank?
      errors << "assigned_on を指定してください" unless date
      errors << "勤務帯が正しくありません" if shifts.empty? || (shifts - NursingAssignment::SHIFTS).any?
      return render json: { errors: errors }, status: :unprocessable_content if errors.any?

      items = Array(params[:items]).map { |item| item.permit(:shift, :patient_id, :practitioner_id, :practitioner_name) }
      if items.size > MAX_ITEMS_PER_REQUEST
        return render json: { errors: ["一度に割り付けられるのは #{MAX_ITEMS_PER_REQUEST} 件までです"] },
                      status: :unprocessable_content
      end
      if items.any? { |item| shifts.exclude?(item[:shift].to_s) }
        return render json: { errors: ["shifts に含まれない勤務帯の割り付けがあります"] }, status: :unprocessable_content
      end

      created = NursingAssignment.transaction do
        NursingAssignment.where(ward_id: ward_id, assigned_on: date, shift: shifts).delete_all
        items.each do |item|
          NursingAssignment.where(assigned_on: date, shift: item[:shift], patient_id: item[:patient_id]).delete_all
        end
        items.map do |item|
          NursingAssignment.create!(
            ward_id: ward_id,
            assigned_on: date,
            shift: item[:shift],
            patient_id: item[:patient_id],
            practitioner_id: item[:practitioner_id],
            practitioner_name: item[:practitioner_name].presence,
            assigned_by_id: current_user&.practitioner_fhir_id || params[:assigned_by_id].presence,
            assigned_by_name: params[:assigned_by_name].presence,
          )
        end
      end
      render json: { total: created.size, items: created.map { |a| detail(a) } }
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    end

    private

    def parse_date(value)
      Date.iso8601(value.to_s)
    rescue Date::Error
      nil
    end

    def detail(assignment)
      assignment.as_json(only: %i[id ward_id assigned_on shift patient_id practitioner_id practitioner_name
                                  assigned_by_id assigned_by_name updated_at])
    end
  end
end
