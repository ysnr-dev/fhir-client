module Master
  # 患者フォルダに入れた患者(docs/patient-folder-design.md)。患者の中身は持たず、
  # 画面が上流の Patient を id で引いて並べる。
  class PatientFolderMembersController < BaseController
    include PatientFolderAccess

    MAX_PATIENTS_PER_REQUEST = 500

    before_action :set_record, only: %i[update destroy]
    before_action -> { authorize_folder!(@record.patient_folder) }, only: %i[update destroy]

    # 次のどちらか。
    #   patient_folder_id(+ include_descendants) … フォルダの中の患者。下位フォルダの分も含められる
    #   patient_id(+ department_id)              … その患者が入っている、見えるフォルダの登録
    def index
      if params[:patient_folder_id].present?
        folder = PatientFolder.find(params[:patient_folder_id])
        authorize_folder!(folder)
        return if performed?

        folder_ids = ActiveModel::Type::Boolean.new.cast(params[:include_descendants]) ? folder.self_and_descendant_ids : [folder.id]
        members = PatientFolderMember.where(patient_folder_id: folder_ids)
      elsif params[:patient_id].present?
        members = PatientFolderMember.where(patient_id: params[:patient_id], patient_folder_id: visible_folders.select(:id))
      else
        return render json: { errors: ["patient_folder_id か patient_id を指定してください"] }, status: :unprocessable_content
      end

      items = members.order(:created_at, :id).map { |m| detail(m) }
      render json: { total: items.size, items: items }
    end

    # 患者をまとめて入れる。すでに入っている患者は飛ばす(作った分だけを返す)。
    def create
      folder = PatientFolder.find(params.require(:patient_folder_id))
      authorize_folder!(folder)
      return if performed?

      patient_ids = Array(params[:patient_ids]).map(&:to_s).compact_blank.uniq
      if patient_ids.empty?
        return render json: { errors: ["患者を指定してください"] }, status: :unprocessable_content
      end
      if patient_ids.size > MAX_PATIENTS_PER_REQUEST
        return render json: { errors: ["一度に登録できる患者は #{MAX_PATIENTS_PER_REQUEST} 人までです"] },
                      status: :unprocessable_content
      end

      existing = folder.members.where(patient_id: patient_ids).pluck(:patient_id)
      created = PatientFolderMember.transaction do
        (patient_ids - existing).map do |patient_id|
          folder.members.create!(
            patient_id: patient_id,
            note: params[:note].presence,
            added_by_id: current_user&.practitioner_fhir_id || params[:added_by_id].presence,
            added_by_name: params[:added_by_name].presence,
          )
        end
      end
      render json: { created: created.size, skipped: existing.size, items: created.map { |m| detail(m) } },
             status: :created
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    end

    # メモの書き換えと、別のフォルダへの移動。
    def update
      if params.key?(:patient_folder_id)
        target = PatientFolder.find(params[:patient_folder_id])
        authorize_folder!(target)
        return if performed?
      end

      if @record.update(params.permit(:patient_folder_id, :note))
        render json: detail(@record)
      else
        render_validation_errors(@record)
      end
    end

    def destroy
      @record.destroy!
      head :no_content
    end

    private

    def model_class = PatientFolderMember

    def detail(member)
      member.as_json(only: %i[id patient_folder_id patient_id note added_by_id added_by_name created_at])
    end
  end
end
