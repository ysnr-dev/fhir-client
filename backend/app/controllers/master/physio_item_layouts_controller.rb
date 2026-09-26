module Master
  # 生理検査オーダーレイアウトの編集。配布ファイルが無い画面編集専用マスタなので
  # 取込は持たない。
  class PhysioItemLayoutsController < BaseController
    include ItemLayoutActions
  end
end
