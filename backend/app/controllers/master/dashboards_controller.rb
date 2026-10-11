module Master
  # ダッシュボード(docs/dashboard-design.md)の登録・参照。データ抽出の条件と同じく現場が育てる
  # 運用データで、持ち主と認可は ScopedDefinitions。タイルの実行は画面が上流を直接引く。
  class DashboardsController < BaseController
    include ScopedDefinitions

    private

    def model_class = Dashboard
  end
end
