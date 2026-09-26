module Master
  # 処置オーダーレイアウトの編集。配布ファイルが無い画面編集専用マスタなので
  # 取込は持たない。
  class TreatmentItemLayoutsController < BaseController
    include ItemLayoutActions
  end
end
