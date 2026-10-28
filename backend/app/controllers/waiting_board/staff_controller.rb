module WaitingBoard
  # 待合表示板の職員向け API(docs/waiting-board-design.md §2)。リンクの発行・取消と受付番号の採番。
  # ログインしていれば誰でも使える(施設設定と同じ)。
  class StaffController < ActionController::API
    include UserAuthentication

    before_action :authorize_user!
    before_action :verify_user_csrf!

    # リンクの発行。
    def create_link
      label = params[:label].to_s.strip
      return render json: { error: "名前を入れてください" }, status: :unprocessable_content if label.blank?

      link, token = WaitingBoardLink.issue!(
        label: label,
        location_ids: Array(params[:location_ids]).map(&:to_s).reject(&:blank?).uniq,
        created_by_id: staff_identity&.dig(:id),
        created_by_name: staff_identity&.dig(:name)
      )
      render json: link_json(link).merge(path: board_path(token)), status: :created
    end

    # 有効なリンク。path は施設設定から表示板を開くため(起こし直せないリンクは null)。
    def links
      items = WaitingBoardLink.active.order(:created_at).map { |link| link_json(link).merge(path: board_path(link.token)) }
      render json: { items: items }
    end

    def revoke_link
      WaitingBoardLink.find(params[:id]).revoke!
      head :no_content
    end

    # 受付番号。day は日本時間の暦日(frontend の today())。無ければ施設の今日。
    def create_reception_number
      day = params[:day].present? ? Date.iso8601(params[:day].to_s) : FacilityClock.today
      render json: { day: day.iso8601, number: ReceptionNumberCounter.next!(day) }, status: :created
    rescue Date::Error
      render json: { error: "day は YYYY-MM-DD で送ってください" }, status: :unprocessable_content
    end

    private

    def staff_identity
      user = current_user
      return nil unless user

      { id: user.practitioner_fhir_id, name: user.login_id }
    end

    def board_path(token) = token && "/board/#{token}"

    def link_json(link)
      {
        id: link.id,
        label: link.label,
        location_ids: link.location_ids,
        created_at: link.created_at.iso8601,
        created_by_name: link.created_by_name
      }
    end
  end
end
