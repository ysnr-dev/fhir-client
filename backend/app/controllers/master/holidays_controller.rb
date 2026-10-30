module Master
  # 祝日・休診日マスタ。カレンダーと日付の割り付け(予約枠の生成・放射線治療の予定)が期間で引く。
  # 国民の祝日は内閣府 CSV の取込、施設の休診日は画面から 1 日ずつ登録する。
  class HolidaysController < BaseController
    include Importable

    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::Holiday.all
      scope = scope.where(holiday_date: params[:from]..) if params[:from].present?
      scope = scope.where(holiday_date: ..params[:to]) if params[:to].present?
      scope = scope.where(kind: params[:kind]) if params[:kind].present?
      render json: paginate(scope.order(:holiday_date), max_per: 1000)
    end

    private

    def import_result_json(result)
      { imported: result.imported_count, skipped: result.skipped_count }
    end
  end
end
