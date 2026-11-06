module Master
  # 頻用病名(docs/features/patient-profile.md「頻用病名」)の登録・参照。現場が育てる運用データで、
  # 持ち主と認可は ScopedDefinitions。病名・修飾語の中身は画面が病名マスタから選んだ値をそのまま持つ。
  class FavoriteConditionsController < BaseController
    include ScopedDefinitions

    private

    def model_class = FavoriteCondition
  end
end
