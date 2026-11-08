module Admin
  # ファイルカテゴリの CRUD(CategoryRecords)。上流中継ではなく backend DB に保存する。
  # カテゴリを消しても DocumentReference.category は残り、一覧では coding.display に
  # 焼き込んだ表示名で引き続き同じ名前のまま表示される。
  class FileCategoriesController < BaseController
    include CategoryRecords

    private

    def category_class = FileCategory
  end
end
