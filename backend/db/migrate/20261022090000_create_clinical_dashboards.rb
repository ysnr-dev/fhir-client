class CreateClinicalDashboards < ActiveRecord::Migration[8.0]
  # 診療ダッシュボード(docs/clinical-dashboard-design.md)。カルテ左ペインのタブをカードとして並べる。列はダッシュボードと同じ。
  def change
    create_table :clinical_dashboards do |t|
      t.string :code, null: false
      t.string :scope, null: false
      t.string :owner_id
      t.string :owner_name
      t.string :name, null: false
      t.jsonb :definition, null: false, default: {}
      t.integer :display_order
      t.boolean :active, null: false, default: true
      t.timestamps
    end
    add_index :clinical_dashboards, :code, unique: true
    add_index :clinical_dashboards, %i[scope owner_id]
  end
end
