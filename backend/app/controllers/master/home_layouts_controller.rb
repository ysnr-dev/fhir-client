module Master
  # ホームのカードの並び(docs/features/home.md)。ログイン中の医療従事者につき 1 つ。
  # administrator は医療従事者に紐付かないので持たない(403)。
  class HomeLayoutsController < BaseController
    before_action :require_owner!

    # 保存していない人も 200 で definition: null を返す(画面は毎回引くので、無いのが普通の
    # 状態を 404 にしない。null なら職種の既定で出す)。
    def show
      render json: detail(HomeLayout.find_by(practitioner_id: owner_id))
    end

    # 置き換え(1 人につき 1 つ)。
    def update
      layout = HomeLayout.find_or_initialize_by(practitioner_id: owner_id)
      layout.definition = definition_param
      if layout.save
        render json: detail(layout)
      else
        render_validation_errors(layout)
      end
    end

    # 既定に戻す。
    def destroy
      HomeLayout.where(practitioner_id: owner_id).delete_all
      head :no_content
    end

    private

    # ログイン中は本人に固定し、パラメータは見ない。ヘッダーのトークン・認証なしの環境では
    # practitioner_id を受ける(ScopedDefinitions の forced_owner_id と同じ考え方)。
    def owner_id
      return current_user&.practitioner_fhir_id if @user_auth == :session

      params[:practitioner_id].presence
    end

    def require_owner!
      render json: { error: "forbidden" }, status: :forbidden if owner_id.blank?
    end

    # BaseController の permit は jsonb のネストを黙って落とすので、definition は丸ごと受け取る
    # (形の検証はモデルが担う)。
    def definition_param
      raw = params[:definition]
      raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw
    end

    def detail(layout)
      {
        practitioner_id: owner_id,
        definition: layout&.definition_with_defaults,
        updated_at: layout&.updated_at
      }
    end
  end
end
