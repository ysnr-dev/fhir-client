# CDS Hooks のサービス提供元(docs/cds-hooks-design.md §2.1)。
#
# 1 行が `/cds-services` を持つ 1 つの URL。配下に複数のサービス(id)があり、
# その一覧と prefetch テンプレートは保存せず discovery で読む(提供元がサービスを
# 足しても登録し直さなくてよい)。
class CdsService < ApplicationRecord
  # 任意の Bearer。ブラウザへは有無だけ返す。
  encrypts :auth_token

  validates :name, presence: true, length: { maximum: 100 }
  validates :base_url, presence: true
  validate :base_url_is_absolute_https

  scope :enabled, -> { where(enabled: true) }
  scope :ordered, -> { order(:position, :id) }

  private

  # prefetch で患者情報を送る先なので、開発以外は https に限る。
  def base_url_is_absolute_https
    return if base_url.blank?

    uri = URI.parse(base_url)
    schemes = Rails.env.production? ? %w[https] : %w[https http]
    return if uri.absolute? && schemes.include?(uri.scheme) && uri.host.present?

    errors.add(:base_url, Rails.env.production? ? "は https の絶対 URL にしてください" : "は絶対 URL にしてください")
  rescue URI::InvalidURIError
    errors.add(:base_url, "の形式が正しくありません")
  end
end
