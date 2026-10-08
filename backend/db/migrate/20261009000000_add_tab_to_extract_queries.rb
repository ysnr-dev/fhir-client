# データ抽出の条件を、記録を表にするタブ(テンプレート・検査結果など)でも保存できるようにする。
# 既存の条件はすべて「患者」タブのもの。
class AddTabToExtractQueries < ActiveRecord::Migration[8.0]
  def change
    add_column :extract_queries, :tab, :string, null: false, default: "patient"
    add_index :extract_queries, :tab
  end
end
