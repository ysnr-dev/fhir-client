module Master
  # セット(1オーダー → 複数の検査)の構成。オーダー項目の詳細画面から編集する。
  class PhysioSetItemsController < BaseController
    include SetItemActions

    private

    def member_columns
      %w[exam_type_code]
    end
  end
end
