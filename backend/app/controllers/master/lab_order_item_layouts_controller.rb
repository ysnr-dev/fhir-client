module Master
  # 検査オーダーレイアウトの編集。配布ファイルが無い画面編集専用マスタなので
  # 取込は持たない。
  class LabOrderItemLayoutsController < BaseController
    include ItemLayoutActions

    private

    def item_code_column
      "order_item_code"
    end
  end
end
