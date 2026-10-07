module Master
  # 患者フォルダの読み書きの可否。本人のフォルダ(scope = practitioner)はログイン本人だけが
  # 読み書きできる(患者の仕分けは個人のメモに近く、オーダーセットのように他人が開く使い道が無い)。
  # 院内共通・診療科は誰でも読め、書き込みの可否は画面側で決める(backend は担当科を知らない)。
  # ヘッダのトークン(運用ツール)と認証なしモードは制限しない。
  module PatientFolderAccess
    extend ActiveSupport::Concern

    private

    def folder_accessible?(folder)
      return true unless folder.scope == "practitioner"
      return true unless @user_auth == :session

      current_user.present? && folder.owner_id == current_user.practitioner_fhir_id
    end

    def authorize_folder!(folder)
      render json: { error: "forbidden" }, status: :forbidden unless folder_accessible?(folder)
    end

    # 一覧で見せる本人のフォルダの持ち主。ログイン中は本人に固定し、パラメータは見ない。
    def visible_practitioner_id
      return params[:practitioner_id].presence unless @user_auth == :session

      current_user&.practitioner_fhir_id
    end

    def visible_folders
      PatientFolder.roots_for(
        department_id: params[:department_id].presence,
        practitioner_id: visible_practitioner_id,
      )
    end
  end
end
