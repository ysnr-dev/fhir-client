# Web 問診のリンク(docs/web-intake-design.md)。予約・受付から発行し、患者が QR で開く。
#
# トークンは発行時に 1 度だけ返し、DB には SHA-256 だけを持つ。患者は生年月日の照合に通ると
# 質問票を開ける。回答(IntakeResponse)は職員が取り込むまで上流に書かない。
class IntakeLink < ApplicationRecord
  MAX_FAILED_ATTEMPTS = 5

  encrypts :birth_date

  has_many :responses, class_name: "IntakeResponse", dependent: :destroy

  validates :token_digest, presence: true, uniqueness: true
  validates :patient_fhir_id, presence: true
  validates :expires_at, presence: true

  scope :active, -> { where(revoked_at: nil).where("expires_at > ?", Time.current) }

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

  def expired? = revoked_at.present? || expires_at <= Time.current
  def locked? = failed_attempts >= MAX_FAILED_ATTEMPTS
  def verified? = verified_at.present?

  # 患者画面に返す状態。
  def public_status
    return "expired" if expired?
    return "locked" if locked?

    verified? ? "ready" : "verify"
  end

  # 生年月日の照合。合えば verified_at、違えば失敗回数を進める。
  def verify_birth_date!(value)
    expected = parse_date(birth_date)
    given = parse_date(value)
    if expected && given && expected == given
      update!(verified_at: Time.current)
      true
    else
      increment!(:failed_attempts)
      false
    end
  end

  # 職員の一覧に出す状態。
  def staff_status
    return "imported" if responses.any? { |r| r.status == "imported" }
    return "answered" if responses.any? { |r| r.status == "pending" }

    expired? ? "expired" : "issued"
  end

  private

  def parse_date(value)
    Date.parse(value.to_s)
  rescue Date::Error, TypeError
    nil
  end
end
