module Master
  # 生理検査の検査種別(心電図・超音波検査 など)のメンテナンス。
  # 配布マスタが無いので取込は持たず、画面から施設が自由に登録する。
  class PhysioExamTypesController < BaseController
    include ExamTypeActions
  end
end
