module Master
  # 内視鏡オーダー項目のメンテナンス。アクションは生理検査と共通(ExamItemActions)。
  class EndoscopyItemsController < BaseController
    include ExamItemActions
  end
end
