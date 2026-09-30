# 掲示板の投稿(院内のお知らせ)1 件。患者に紐付かない施設内の連絡で、ログインした人なら
# 誰でも読める。掲載期間(published_from 〜 published_until)の中にあるものだけをホームに出し、
# 掲示板の画面では期間外も出す(掲載前・掲載終了の印を付ける)。
class BulletinPost < ApplicationRecord
  TITLE_MAX = 200
  BODY_MAX = 10_000

  before_validation :assign_published_from

  validates :title, presence: true, length: { maximum: TITLE_MAX }
  validates :body, length: { maximum: BODY_MAX }
  validates :published_from, presence: true
  validate :published_until_not_before_from

  # 固定を先頭に、あとは掲載開始日の新しい順。同じ日は後から投稿したものを先に。
  scope :ordered, -> { order(pinned: :desc, published_from: :desc, id: :desc) }

  # 指定した日に掲載中のもの。
  scope :current_on, lambda { |date|
    where(published_from: ..date).where("published_until IS NULL OR published_until >= ?", date)
  }

  def current_on?(date)
    published_from <= date && (published_until.nil? || published_until >= date)
  end

  private

  # 掲載開始日を省略したら投稿した日から。画面は必ず送ってくる(サーバーの時計は UTC で、
  # 朝 9 時前は前日になる)ので、これは運用ツールから直接投稿したときの保険。
  def assign_published_from
    self.published_from = Date.current if published_from.blank?
  end

  def published_until_not_before_from
    return if published_until.blank? || published_from.blank?
    return if published_until >= published_from

    errors.add(:published_until, "は掲載開始日以降にしてください")
  end
end
