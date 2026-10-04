class CreateMasterInsulinScaleSets < ActiveRecord::Migration[8.0]
  def change
    # インスリンのスライディングスケールのセット。注射オーダーのスケールの入力で選ぶと、行が写る
    # (docs/injection-order-design.md §10.5)。オーダーには写した行と、どのセットから写したかだけが残る。
    create_table :master_insulin_scale_sets do |t|
      t.string :name, null: false
      # glucose = 血糖(mg/dL) / meal = 主食の摂取量(%) / free = フリースケール(条件を文で書く)
      t.string :kind, null: false
      # [{low, high, dose, note, condition}]。low/high は血糖・食事量、condition はフリースケールの条件。
      t.jsonb :rows, null: false, default: []
      t.integer :display_order

      t.timestamps
    end
  end
end
