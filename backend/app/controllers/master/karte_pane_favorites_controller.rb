module Master
  # カルテ右ペインの頻用メニュー(docs/features/karte.md)。ログイン中の医療従事者につき 1 つ。
  # administrator は医療従事者に紐付かないので持たない(403)。
  class KartePaneFavoritesController < BaseController
    before_action :require_owner!

    # 保存していない人も 200 で menu_keys: [] を返す。
    def show
      render json: detail(KartePaneFavorite.find_by(practitioner_id: owner_id))
    end

    # 置き換え(1 人につき 1 つ)。
    def update
      favorite = KartePaneFavorite.find_or_initialize_by(practitioner_id: owner_id)
      favorite.menu_keys = params[:menu_keys] || []
      if favorite.save
        render json: detail(favorite)
      else
        render_validation_errors(favorite)
      end
    end

    private

    # ログイン中は本人に固定し、パラメータは見ない(HomeLayoutsController と同じ)。
    def owner_id
      return current_user&.practitioner_fhir_id if @user_auth == :session

      params[:practitioner_id].presence
    end

    def require_owner!
      render json: { error: "forbidden" }, status: :forbidden if owner_id.blank?
    end

    def detail(favorite)
      {
        practitioner_id: owner_id,
        menu_keys: favorite&.menu_keys || [],
        updated_at: favorite&.updated_at
      }
    end
  end
end
