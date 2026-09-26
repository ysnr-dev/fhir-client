module Master
  # セット(1オーダー → 複数の処置)の構成。オーダー項目の詳細画面から編集する。
  class TreatmentSetItemsController < BaseController
    include SetItemActions
  end
end
