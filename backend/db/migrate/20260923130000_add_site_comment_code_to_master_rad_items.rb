# 放射線検査項目に、医事会計へ添える撮影部位の選択式コメント(820 系)のコードを持たせる。
# 2024 年 6 月以降、撮影部位はレセプトに選択式コメントで記載する。項目ごとに部位が決まって
# いるのでマスタの列に持ち、実施入力には出さない(docs/receipt-billing-design.md §2-1)。
class AddSiteCommentCodeToMasterRadItems < ActiveRecord::Migration[8.0]
  def change
    add_column :master_rad_items, :site_comment_code, :string
  end
end
