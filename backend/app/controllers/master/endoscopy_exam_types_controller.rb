module Master
  # 内視鏡の検査種別(上部消化管内視鏡・下部消化管内視鏡 など)のメンテナンス。
  # 配布マスタが無いので取込は持たず、画面から施設が自由に登録する。
  class EndoscopyExamTypesController < BaseController
    include ExamTypeActions
  end
end
