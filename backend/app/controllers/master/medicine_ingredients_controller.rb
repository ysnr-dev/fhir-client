module Master
  # 成分マスタ。オーダー画面が全件を読んで手元で引くのでページングしない。
  # docs/drug-check-master-design.md
  class MedicineIngredientsController < BaseController
    include Importable

    def index
      rows = Master::MedicineIngredient.order(:code_prefix, :ingredient_id)
                                       .pluck(:code_prefix, :ingredient_id, :name, :name_ja)
      render json: rows.map { |code_prefix, ingredient_id, name, name_ja|
        { code_prefix: code_prefix, ingredient_id: ingredient_id, name: name, name_ja: name_ja }
      }
    end
  end
end
