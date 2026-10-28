# 待合表示板のリンク(docs/waiting-board-design.md)。施設設定から発行し、ロビーのモニターが /board/<token> で開く。
#
# トークンはリンクごとの salt と secret_key_base の HMAC で、DB には salt と SHA-256 だけを持つ。
# 施設設定から表示板を開くときはサーバーが起こし直す(DB だけが漏れてもトークンは分からない)。
# secret_key_base を替えると起こし直したトークンが digest と合わなくなるので、そのときは発行し直す。
# 有効期限は持たず、取り消すまで使える。
class WaitingBoardLink < ApplicationRecord
  validates :token_digest, presence: true, uniqueness: true
  validates :label, presence: true

  scope :active, -> { where(revoked_at: nil) }

  # 新しいリンク。戻り値の 2 つ目が生のトークン。
  def self.issue!(attributes)
    salt = SecureRandom.hex(16)
    raw = token_for(salt)
    [create!(attributes.merge(token_salt: salt, token_digest: digest(raw))), raw]
  end

  def self.token_for(salt)
    mac = OpenSSL::HMAC.digest("SHA256", Rails.application.secret_key_base, "waiting-board-link:#{salt}")
    Base64.urlsafe_encode64(mac, padding: false)
  end

  def self.find_by_token(raw)
    return nil if raw.blank?

    find_by(token_digest: digest(raw))
  end

  def self.digest(raw)
    OpenSSL::Digest::SHA256.hexdigest(raw.to_s)
  end

  # 起こし直したトークン。salt の無いリンクと、secret_key_base が替わって digest と合わないものは nil。
  def token
    return nil if token_salt.blank?

    raw = self.class.token_for(token_salt)
    ActiveSupport::SecurityUtils.secure_compare(self.class.digest(raw), token_digest) ? raw : nil
  end

  def revoked? = revoked_at.present?

  def revoke!
    update!(revoked_at: Time.current) unless revoked?
  end

  def location_ids
    Array(super).map(&:to_s).reject(&:blank?)
  end
end
