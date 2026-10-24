module Master
  # 生理検査オーダー項目のメンテナンス。アクションは内視鏡と共通(ExamItemActions)。
  class PhysioItemsController < BaseController
    include ExamItemActions
  end
end
