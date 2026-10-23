module Master
  # 診療ダッシュボード(docs/clinical-dashboard-design.md)の登録・参照。ダッシュボードと同じく
  # 現場が育てる運用データで、持ち主と認可は ScopedDefinitions。カードの中身は画面が上流を直接引く。
  class ClinicalDashboardsController < BaseController
    include ScopedDefinitions

    private

    def model_class = ClinicalDashboard
  end
end
