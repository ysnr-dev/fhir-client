module Master
  # 内視鏡オーダーレイアウトの編集。配布ファイルが無い画面編集専用マスタなので
  # 取込は持たない。
  class EndoscopyItemLayoutsController < BaseController
    include ItemLayoutActions
  end
end
