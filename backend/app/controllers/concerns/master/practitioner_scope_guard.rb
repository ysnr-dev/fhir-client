module Master
  # 持ち主を持つ運用データ(ScopedDefinitions のモデル・オーダーセット)の、医師スコープの認可。
  # 医師かどうかは上流の PractitionerRole にしか無く backend からは引けないので、院内共通・
  # 診療科スコープの書き込みは画面側で医師に限る。backend が厳密に守るのは「医師スコープの
  # 持ち主はログイン本人」だけ。読み取りは誰でもできる。
  module PractitionerScopeGuard
    private

    # 医師スコープの持ち主はログイン中の本人に固定する(他人の owner_id を送られても
    # 無視する)。認証なしモード(ADMIN_TOKEN 未設定)は開発の摩擦を無くすためのものなので
    # パラメータの owner_id を通す。administrator は医療従事者と紐付かないので nil に
    # なり、呼び出し側で 403 にする。
    def forced_owner_id(scope)
      return nil unless scope == "practitioner"
      return params[:owner_id].presence if @user_auth == :none

      current_user&.practitioner_fhir_id
    end

    def authorize_practitioner_scope!
      return unless @record.scope == "practitioner"
      return if @user_auth == :none

      render_forbidden unless current_user && @record.owner_id == current_user.practitioner_fhir_id
    end

    def render_forbidden
      render json: { error: "forbidden" }, status: :forbidden
    end
  end
end
