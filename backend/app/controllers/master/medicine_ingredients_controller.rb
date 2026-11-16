module Master
  # 成分マスタ。オーダー画面が全件を読んで手元で引くのでページングしない。
  # docs/drug-check-master-design.md
  class MedicineIngredientsController < BaseController
    include Importable

    def index
      rows = Master::MedicineIngredient.order(:code_prefix, :ingredient_id)
                                       .pluck(:code_prefix, :ingredient_id, :name, :name_ja, :atc_codes, :amount, :amount_unit)
      render json: rows.map { |code_prefix, ingredient_id, name, name_ja, atc_codes, amount, amount_unit|
        { code_prefix: code_prefix, ingredient_id: ingredient_id, name: name, name_ja: name_ja,
          atc_codes: atc_codes.split, amount: amount&.to_f, amount_unit: amount_unit }
      }
    end
  end
end
