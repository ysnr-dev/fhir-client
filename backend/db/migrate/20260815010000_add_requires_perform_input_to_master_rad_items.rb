class AddRequiresPerformInputToMasterRadItems < ActiveRecord::Migration[8.0]
  # 実施入力の有無。撮影しても実施入力(手技料・造影剤・器材・線量)を残さない項目が
  # あるため、項目ごとに持たせる。false の項目は放射線検査一覧の「実施」で実施入力を
  # 開かずそのまま実施済にし、実施記録(Procedure 一式)を作らない
  # -- カルテカードにも実施情報は出ない。
  #
  # 既定を true にしているのは、これまで全項目が実施入力を開いていたため。
  # 既存データの挙動を変えない。
  def change
    add_column :master_rad_items, :requires_perform_input, :boolean, null: false, default: true
  end
end
