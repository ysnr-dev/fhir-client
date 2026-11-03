class AddStandardPathCodeToMasterPathways < ActiveRecord::Migration[8.0]
  # 元ひな型パスの標準クリニカルパスコード・名称・ひな型版(JAHIS ePath 実装ガイド 第 4 章 No.1、
  # docs/clinical-pathway-design.md §3)。施設独自のパスは空のまま。
  def change
    add_column :master_pathways, :standard_path_code, :string
    add_column :master_pathways, :standard_path_name, :string
    add_column :master_pathways, :template_version, :string
  end
end
