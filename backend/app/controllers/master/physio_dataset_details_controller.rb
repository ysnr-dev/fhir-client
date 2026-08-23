module Master
  # 実施入力用データセットの明細(手技料・薬剤・器材)。データセットの詳細画面から
  # 編集し、実施入力モーダルからは複数データセット分をまとめて読む。
  class PhysioDatasetDetailsController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::PhysioDatasetDetail.with_names
      # カンマ区切りで複数指定可(オーダーに載っている検査項目に紐付く
      # 全データセットの明細を、実施入力が1リクエストで引くため)。
      if params[:dataset_code].present?
        scope = scope.where(dataset_code: params[:dataset_code].split(","))
      end
      scope = scope.where(detail_type: params[:detail_type]) if params[:detail_type].present?

      render json: paginate(scope.order(:dataset_code).in_display_order)
    end

    def create
      record = Master::PhysioDatasetDetail.new(record_params)
      # 追加順に並べる(明示されていれば従う)。
      record.display_order ||= next_display_order(record.dataset_code)
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    private

    def next_display_order(dataset_code)
      (Master::PhysioDatasetDetail.where(dataset_code: dataset_code).maximum(:display_order) || 0) + 1
    end
  end
end
