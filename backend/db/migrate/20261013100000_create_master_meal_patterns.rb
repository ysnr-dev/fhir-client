class CreateMasterMealPatterns < ActiveRecord::Migration[8.0]
  def change
    # パターン食。術後の食上げ(流動食 → 三分粥 → … → 常食)のように段階的に変わる食事の
    # 雛形で、オーダー画面で選ぶと段階ごとの食事オーダーがまとめて立つ
    # (docs/meal-order-design.md §2.11・§3.5)。
    create_table :master_meal_patterns do |t|
      t.string :pattern_code, null: false
      t.string :name, null: false
      t.string :name_kana
      # [{meals, diet, dietIsFasting, staples, sideDishForm, saltLimit, fastingReason, comment}]。
      # 食事オーダーのフォーム値の部分集合 + 食数(meals。null は「継続」で最後の段階だけ)。
      t.jsonb :steps, null: false, default: []
      t.integer :display_order
      t.text :note
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end
    add_index :master_meal_patterns, :pattern_code, unique: true
  end
end
