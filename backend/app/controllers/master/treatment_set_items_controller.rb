module Master
  # セット(1オーダー → 複数の処置)の構成。オーダー項目の詳細画面から編集する。
  class TreatmentSetItemsController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::TreatmentSetItem.all
      # どちらもカンマ区切りで複数指定可(オーダー画面が選択中のセットの構成を
      # まとめて引くため)。
      if params[:set_item_code].present?
        scope = scope.where(set_item_code: params[:set_item_code].split(","))
      end
      if params[:member_item_code].present?
        scope = scope.where(member_item_code: params[:member_item_code].split(","))
      end

      # 構成項目の名称を添える(オーダー画面がセットの中身を並べて見せるため)。
      scope = scope
        .joins("LEFT JOIN master_treatment_items " \
               "ON master_treatment_items.item_code = master_treatment_set_items.member_item_code")
        .select(
          "master_treatment_set_items.*",
          "master_treatment_items.name AS member_name",
          "master_treatment_items.short_name AS member_short_name",
        )

      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")))
    end

    def create
      record = Master::TreatmentSetItem.new(record_params)
      # 追加順に並べる(明示されていれば従う)。
      record.display_order ||= next_display_order(record.set_item_code)
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    private

    def next_display_order(set_item_code)
      (Master::TreatmentSetItem.where(set_item_code: set_item_code).maximum(:display_order) || 0) + 1
    end
  end
end
