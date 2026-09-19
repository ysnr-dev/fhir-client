class AddPhasesToMasterPathways < ActiveRecord::Migration[8.0]
  # フェーズ(連続する病日のまとまり)と、フェーズの終わりで選ぶ分岐
  # (docs/clinical-pathway-design.md §3.2)。病日は phase_key でフェーズに結び、
  # 分岐先どうしは同じ病日から始まるので、病日の一意性はフェーズの中へ緩める。
  class MigrationPathway < ActiveRecord::Base
    self.table_name = "master_pathways"
  end

  class MigrationPhase < ActiveRecord::Base
    self.table_name = "master_pathway_phases"
  end

  class MigrationEvent < ActiveRecord::Base
    self.table_name = "master_pathway_events"
  end

  def up
    create_table :master_pathway_phases do |t|
      t.string :pathway_code, null: false
      t.string :phase_key, null: false
      t.integer :display_order
      t.string :name
      t.text :note
      t.timestamps
    end
    add_index :master_pathway_phases, %i[pathway_code phase_key], unique: true

    create_table :master_pathway_phase_branches do |t|
      t.string :pathway_code, null: false
      t.string :from_phase_key, null: false
      # NULL = ここでパスを終了
      t.string :to_phase_key
      t.text :criteria
      t.integer :display_order
      t.timestamps
    end
    add_index :master_pathway_phase_branches, %i[pathway_code from_phase_key],
              name: "idx_master_pathway_phase_branches_from"

    add_column :master_pathway_events, :phase_key, :string

    MigrationPathway.pluck(:pathway_code).each do |code|
      key = SecureRandom.uuid
      MigrationPhase.create!(pathway_code: code, phase_key: key, display_order: 1)
      MigrationEvent.where(pathway_code: code).update_all(phase_key: key)
    end
    # 本体の無い病日(孤児)が残っていれば片付けられないので、キーだけ埋める。
    MigrationEvent.where(phase_key: nil).update_all(phase_key: SecureRandom.uuid)

    change_column_null :master_pathway_events, :phase_key, false
    remove_index :master_pathway_events, name: "idx_master_pathway_events_day"
    add_index :master_pathway_events, %i[pathway_code phase_key elapsed_days path_step],
              unique: true, name: "idx_master_pathway_events_day"
  end

  def down
    remove_index :master_pathway_events, name: "idx_master_pathway_events_day"
    add_index :master_pathway_events, %i[pathway_code elapsed_days path_step],
              unique: true, name: "idx_master_pathway_events_day"
    remove_column :master_pathway_events, :phase_key
    drop_table :master_pathway_phase_branches
    drop_table :master_pathway_phases
  end
end
