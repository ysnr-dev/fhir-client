module Master
  # 手術室のブロックスケジュール(曜日ごとの科割り当て)のメンテナンス。
  # 配布マスタが無いので取込は持たず、画面から施設が登録する。
  class SurgeryRoomBlocksController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::SurgeryRoomBlock.all
      scope = scope.where(location_id: params[:location_id].split(",")) if params[:location_id].present?
      scope = scope.where(weekday: params[:weekday].to_i) if params[:weekday].present?
      scope = scope.where(department_code: params[:department_code]) if params[:department_code].present?
      # active=true は今日使える割り当てだけ。日付を渡せばその日で判定する
      # (カレンダーが過去日・未来日を描くため)。
      scope = scope.active_on(active_on_date || Date.current) if params[:active] == "true"

      render json: paginate(scope.order(:location_id, :weekday, :start_time))
    end

    private

    def active_on_date
      Date.parse(params[:date]) if params[:date].present?
    rescue Date::Error
      nil
    end
  end
end
