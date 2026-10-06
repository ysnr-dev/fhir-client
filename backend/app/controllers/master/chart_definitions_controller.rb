module Master
  # チャート定義の登録・参照。施設の参照表(マスタ)ではなく現場が育てる運用データだが、
  # ログイン認証・CSRF・エラー整形を /master の基底と共有するためここに置く
  # (オーダーセットと同じ理由。docs/order-set-design.md §1.2)。持ち主と認可は ScopedDefinitions。
  class ChartDefinitionsController < BaseController
    include ScopedDefinitions

    private

    def model_class = ChartDefinition
  end
end
