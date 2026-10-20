# カルテの「SMARTアプリ」タブから起動する SMART on FHIR アプリ(docs/smart-app-launch-design.md)。
#
# 認可の実体は上流 fhir-server の OAuth クライアント(client_id)で、スコープや redirect_uri
# はそちらの登録が正。この行は「名称・起動 URL・表示方法・並び順」だけを持つ。
class SmartApp < ApplicationRecord
  DISPLAYS = %w[embed window].freeze
  # 上流の client_id は UUID(Admin::OauthClientsController::ID_PATTERN と同じ形)。
  CLIENT_ID_PATTERN = /\A[0-9a-fA-F-]{1,64}\z/

  validates :name, presence: true, length: { maximum: 100 }
  validates :client_id, presence: true, uniqueness: true, format: { with: CLIENT_ID_PATTERN }
  validates :launch_url, presence: true
  validates :display, inclusion: { in: DISPLAYS }
  validate :launch_url_is_absolute_https

  scope :enabled, -> { where(enabled: true) }
  scope :ordered, -> { order(:position, :id) }

  def embed?
    display == "embed"
  end

  private

  # 起動 URL には launch トークンが載るので、開発以外は https に限る。
  def launch_url_is_absolute_https
    return if launch_url.blank?

    uri = URI.parse(launch_url)
    schemes = Rails.env.production? ? %w[https] : %w[https http]
    return if uri.absolute? && schemes.include?(uri.scheme) && uri.host.present?

    errors.add(:launch_url, Rails.env.production? ? "は https の絶対 URL にしてください" : "は絶対 URL にしてください")
  rescue URI::InvalidURIError
    errors.add(:launch_url, "の形式が正しくありません")
  end
end
