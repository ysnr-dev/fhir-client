class AddMajorEventTaskKeyToMasterPathwayEvents < ActiveRecord::Migration[8.0]
  # 主要イベントにするタスク(その病日の手術・内視鏡・放射線治療のタスクの task_key)。名前の既定と
  # 実施の日時をそのタスクのオーダーから取る。空なら主要イベント名だけの自由入力(docs/clinical-pathway-design.md §7.13)。
  def change
    add_column :master_pathway_events, :major_event_task_key, :string
  end
end
