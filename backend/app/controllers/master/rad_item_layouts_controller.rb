module Master
  # 放射線オーダーレイアウトの編集。配布ファイルが無い画面編集専用マスタなので
  # 取込は持たない。
  class RadItemLayoutsController < BaseController
    include ItemLayoutActions
  end
end
