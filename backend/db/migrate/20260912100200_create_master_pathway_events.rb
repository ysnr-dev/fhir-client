class CreateMasterPathwayEvents < ActiveRecord::Migration[8.0]
  # パスの病日・イベント(ePath の Event PlanDefinition)。入院日を 1、前日を -1 とし
  # 0 は使わない。同じ病日の中を分ける「パスステップ」は列だけ持つ(第 1 段階は 1 固定)。
  def change
    create_table :master_pathway_events do |t|
      t.string :pathway_code, null: false
      t.integer :display_order
      t.integer :elapsed_days, null: false            # 病日(入院日 = 1、入院前日 = -1)
      t.integer :path_step, null: false, default: 1   # パスステップ回数目
      t.string :path_step_name
      t.string :title                                 # 入院日 / 手術当日 / 退院日 …
      t.string :allowable_condition_type              # 許容経過日数条件 起点日種別(1 前回イベント / 2 適用開始日 / 3 指定日付)
      t.integer :allowable_days                       # 指定起点病日
      t.integer :allowable_range_low                  # 許容日数の下限
      t.integer :allowable_range_high                 # 許容日数の上限
      t.text :note
      t.timestamps
    end
    add_index :master_pathway_events, %i[pathway_code elapsed_days path_step], unique: true,
              name: "idx_master_pathway_events_day"
  end
end
