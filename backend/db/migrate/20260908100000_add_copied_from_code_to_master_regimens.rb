class AddCopiedFromCodeToMasterRegimens < ActiveRecord::Migration[8.0]
  # 複製元のレジメンコード。承認済のレジメンは内容を凍結し、直すときは複製して
  # 新しいコードで承認し直す(docs/chemo-regimen-design.md §8.17)。そのままだと
  # 改訂の系列が名前でしか繋がらないので、複製元を 1 本だけ持って辿れるようにする。
  # 他のマスタと同じく外部キーは張らない(複製元が消えてもコードは残す)。
  def change
    add_column :master_regimens, :copied_from_code, :string
    add_index :master_regimens, :copied_from_code
  end
end
