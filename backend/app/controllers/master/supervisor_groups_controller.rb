module Master
  # 指導医グループ。運用データだが、ログイン認証・CSRF・エラー整形を /master の基底と
  # 共有するためここに置く(掲示板と同じ理由)。一覧は構成員をネストして返し、グループは
  # 多くて数十件なのでページングしない。
  class SupervisorGroupsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      render json: SupervisorGroup.includes(:members).order(:name).map { |group| serialize(group) }
    end

    def show
      render json: serialize(@record)
    end

    def create
      record = SupervisorGroup.new(record_params)
      if record.save
        render json: serialize(record), status: :created
      else
        render_validation_errors(record)
      end
    end

    def update
      if @record.update(record_params)
        render json: serialize(@record)
      else
        render_validation_errors(@record)
      end
    end

    # ログイン中の医療従事者から見た関係。研修医として仰ぐ指導医と、指導医として受け持つ
    # 研修医を、グループをまたいで重複なく返す。セッションに医療従事者が無い経路
    # (認証なし・ヘッダ認証)では practitioner_id を受け取る。
    def mine
      practitioner_id = current_user&.practitioner_fhir_id
      practitioner_id = params[:practitioner_id] if practitioner_id.blank? && @user_auth != :session
      if practitioner_id.blank?
        render json: { supervisors: [], trainees: [] }
        return
      end

      render json: {
        supervisors: SupervisorGroup.supervisors_of(practitioner_id),
        trainees: SupervisorGroup.trainees_of(practitioner_id)
      }
    end

    private

    def model_class = SupervisorGroup

    def record_params
      params.permit(:name, :note)
    end

    def serialize(group)
      group.as_json(only: %i[id name note]).merge("members" => group.members)
    end
  end
end
