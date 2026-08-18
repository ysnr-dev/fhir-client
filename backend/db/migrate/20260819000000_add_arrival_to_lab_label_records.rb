class AddArrivalToLabLabelRecords < ActiveRecord::Migration[8.0]
  # 検体到着確認(docs/lab-arrival-design.md §2)。到着は採取管 1 本ごとに起きるので、
  # 管の台帳である発行記録に記録する。オーダー単位の進捗(Task)とは別の事実。
  def change
    # 到着時刻。NULL = 未到着
    add_column :lab_label_records, :arrived_at, :datetime
    # 記録したユーザーの login_id(認証なし運用・administrator では NULL)
    add_column :lab_label_records, :arrived_by, :string
  end
end
