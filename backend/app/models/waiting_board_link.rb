# 待合表示板のリンク(docs/waiting-board-design.md)。施設設定から発行し、ロビーのモニターが /board/<token> で開く。
#
# トークンは発行時に 1 度だけ返し、DB には SHA-256 だけを持つ(Web 問診のリンクと同じ)。
# 有効期限は持たず、取り消すまで使える。
class WaitingBoardLink < ApplicationRecord
  validates :token_digest, presence: true, uniqueness: true
  validates :label, presence: true

  scope :active, -> { where(revoked_at: nil) }

  # 新しいリンク。戻り値の 2 つ目が生のトークン(この場でしか得られない)。
  def self.issue!(attributes)
    raw = SecureRandom.urlsafe_base64(32)
    [create!(attributes.merge(token_digest: digest(raw))), raw]
  end

  def self.find_by_token(raw)
    return nil if raw.blank?

    find_by(token_digest: digest(raw))
  end

  def self.digest(raw)
    OpenSSL::Digest::SHA256.hexdigest(raw.to_s)
  end

  def revoked? = revoked_at.present?

  def revoke!
    update!(revoked_at: Time.current) unless revoked?
  end

  def location_ids
    Array(super).map(&:to_s).reject(&:blank?)
  end
end
