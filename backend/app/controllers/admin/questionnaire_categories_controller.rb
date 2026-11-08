module Admin
  # テンプレートカテゴリの CRUD(CategoryRecords)。上流中継ではなく backend DB に保存する。
  # カテゴリを消しても Questionnaire 側の拡張は残り、選択プルダウンでは拡張に埋まった
  # 表示名で引き続きグループ化される。
  class QuestionnaireCategoriesController < BaseController
    include CategoryRecords

    private

    def category_class = QuestionnaireCategory
  end
end
