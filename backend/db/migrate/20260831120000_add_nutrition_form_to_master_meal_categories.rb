class AddNutritionFormToMasterMealCategories < ActiveRecord::Migration[8.0]
  # 種別の「給与形態」。参考仕様(名古屋第二赤十字病院「食種選択によるオーダエントリ」§1)は
  # 食種を「普通食及び治療食 / 経管･経口食 / 調乳食 / 欠食」に分類し、**分類ごとに入力項目が
  # 違う**と定めている。種別マスタの名称は施設が自由に付けるので(「一般食」「特別食」
  # 「経管栄養」…)、そのままでは画面が入力欄を切り替える判断軸にできない。
  # システムが解釈できる固定コードを 1 列足して、そこを軸にする。
  #
  # 値は Master::MealCategory::NUTRITION_FORMS。既定の oral_diet が既存の種別すべてに
  # あたるので、null: false + default で入れて後方互換にする(未分類の食種も oral_diet 扱い)。
  #
  # 「欠食」を値に入れないのは、食止めが食種マスタの is_fasting で表されているため
  # (docs/meal-order-design.md §2.5)。ここに入れると二重管理になる。
  def change
    add_column :master_meal_categories, :nutrition_form, :string,
               null: false, default: "oral_diet"
  end
end
