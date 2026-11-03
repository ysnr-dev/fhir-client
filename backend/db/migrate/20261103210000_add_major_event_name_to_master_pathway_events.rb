class AddMajorEventNameToMasterPathwayEvents < ActiveRecord::Migration[8.0]
  # 病日の主要イベント(手術・内視鏡治療・放射線治療など。JAHIS ePath 実装ガイド 6.4 majorEvent の eventName)。
  # docs/clinical-pathway-design.md §7.13。
  def change
    add_column :master_pathway_events, :major_event_name, :string
  end
end
