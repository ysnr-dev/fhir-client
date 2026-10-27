# 受付番号(当日の連番)のカウンタ。受付の端末が複数あっても同じ番号を配らないよう、
# 日の行をロックして進める。払い出したが受付が書けなかった番号は欠番になる。
class ReceptionNumberCounter < ApplicationRecord
  # 一意性は DB の unique index に任せる(create_or_find_by! が index の違反を拾って find に回る)。
  validates :day, presence: true

  # その日の次の番号。
  def self.next!(day)
    transaction do
      row = create_or_find_by!(day: day)
      row.lock!
      row.increment!(:last_number)
      row.last_number
    end
  end
end
