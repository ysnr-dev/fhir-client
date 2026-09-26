module Master
  # セット(1オーダー → 複数の撮影)の構成。オーダー項目の詳細画面から編集する。
  class RadSetItemsController < BaseController
    include SetItemActions

    private

    def member_columns
      %w[jj1017_code]
    end
  end
end
