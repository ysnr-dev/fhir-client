module Master
  # 患者フォルダ(docs/patient-folder-design.md)の登録・参照。施設の参照表ではなく現場が
  # 育てる運用データだが、ログイン認証・CSRF・エラー整形を /master の基底と共有するためここに置く。
  class PatientFoldersController < BaseController
    include PatientFolderAccess

    before_action :set_record, only: %i[show update destroy]
    before_action -> { authorize_folder!(@record) }, only: %i[show update destroy]

    # 院内共通 + 指定した診療科 + 本人のフォルダをフラットに全件返す。木の組み立ては画面側
    # (件数が少ない前提でページングしない)。member_count はそのフォルダ直下の患者数。
    def index
      folders = visible_folders.ordered.to_a
      counts = PatientFolderMember.where(patient_folder_id: folders.map(&:id)).group(:patient_folder_id).count
      render json: { total: folders.size, items: folders.map { |f| detail(f, counts[f.id].to_i) } }
    end

    def show
      render json: detail(@record, @record.members.count)
    end

    def create
      record = PatientFolder.new(record_params)
      if record.scope == "practitioner"
        record.owner_id = forced_owner_id
        return render json: { error: "forbidden" }, status: :forbidden if record.owner_id.blank?
      end

      record.display_order = next_display_order(record) if params[:display_order].blank?
      if record.save
        render json: detail(record, 0), status: :created
      else
        render_validation_errors(record)
      end
    end

    # 持ち主は付け替えさせない。
    def update
      if @record.update(record_params.except(:scope, :owner_id, :owner_name))
        render json: detail(@record, @record.members.count)
      else
        render_validation_errors(@record)
      end
    end

    # 子フォルダが残ったまま消すと辿れない孤児ができるため拒否する。中の患者の登録は一緒に消す。
    def destroy
      if PatientFolder.exists?(parent_id: @record.id)
        render json: { errors: ["中にフォルダが残っているため削除できません"] }, status: :unprocessable_content
      else
        @record.destroy!
        head :no_content
      end
    end

    private

    def model_class = PatientFolder

    def record_params
      params.permit(:parent_id, :scope, :owner_id, :owner_name, :name, :display_order)
    end

    # 本人のフォルダの持ち主はログイン中の本人に固定する(他人の owner_id を送られても無視する)。
    # 認証なし・ヘッダのトークンは医療従事者と紐付かないのでパラメータを通す。
    def forced_owner_id
      return params[:owner_id].presence unless @user_auth == :session

      current_user&.practitioner_fhir_id
    end

    def next_display_order(record)
      (PatientFolder.where(scope: record.scope, owner_id: record.owner_id, parent_id: record.parent_id)
                    .maximum(:display_order) || 0) + 1
    end

    def detail(folder, member_count)
      folder.as_json(only: %i[id parent_id scope owner_id owner_name name display_order updated_at])
            .merge("member_count" => member_count)
    end
  end
end
