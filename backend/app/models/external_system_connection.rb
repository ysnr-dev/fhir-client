# 外部システムの設定。システム(system_key)ごとに 1 行。
#
# どの製品と繋ぐかは system_type で選び、それ以外の項目は options に入れる。
# 項目を宣言するのは定義とアダプタで、設定画面はそれを見て描く。
class ExternalSystemConnection < ApplicationRecord
  RECEIPT_COMPUTER = "receipt_computer".freeze

  # ブラウザへ返さず、DB では暗号化して保持する。値で検索しないので非決定的でよい。
  encrypts :password
  encrypts :inbound_token

  validates :system_key, inclusion: { in: ->(_record) { Integrations::ExternalSystems.keys } }, uniqueness: true

  EffectiveConfig = Struct.new(
    :system_key, :system_type, :enabled, :base_url, :username, :password, :inbound_token, :options,
    keyword_init: true
  ) do
    def definition = Integrations::ExternalSystems.find(system_key)

    # 連携に必要なものが揃っているか。enabled だけ立てても動かない。
    # 何が必要かはシステムの定義が決める(API で繋がないシステムもある)。
    def usable?
      return false unless enabled
      return false if definition.nil?
      if definition.section?(:connection)
        return false unless base_url.present? && username.present? && password.present?
      end

      definition.required_field_keys.all? { |key| option(key).present? }
    end

    # 既定を返すのは項目が無いときだけ。空文字は「接頭辞なし」という指定なので
    # そのまま通す(接頭辞を持たないオンプレ構成がある)。
    def option(key, default = nil)
      (options || {}).fetch(key.to_s, default)
    end
  end

  # 実効設定は連携のたびに読まれるので、行をプロセス内に短時間だけ持つ。
  CACHE_TTL = 30.seconds

  @cache_mutex = Mutex.new
  @cached_rows = {}
  @cached_at = {}

  class << self
    def current(system_key)
      return find_or_create_row(system_key) if Rails.env.test?

      @cache_mutex.synchronize do
        if @cached_rows[system_key].nil? || @cached_at[system_key] < CACHE_TTL.ago
          @cached_rows[system_key] = find_or_create_row(system_key)
          @cached_at[system_key] = Time.current
        end
        @cached_rows[system_key]
      end
    end

    def reset_cache!
      @cache_mutex.synchronize do
        @cached_rows = {}
        @cached_at = {}
      end
    end

    # env フォールバック込みの実効設定。
    def effective(system_key)
      row = current(system_key)
      prefix = env_prefix(system_key)
      EffectiveConfig.new(
        system_key:    system_key,
        system_type:   row.system_type.presence  || ENV["#{prefix}_TYPE"].presence || default_system_type(system_key),
        enabled:       row.enabled || ENV["#{prefix}_ENABLED"] == "true",
        base_url:      row.base_url.presence      || ENV["#{prefix}_BASE_URL"].presence,
        username:      row.username.presence      || ENV["#{prefix}_USERNAME"].presence,
        password:      row.password.presence      || ENV["#{prefix}_PASSWORD"].presence,
        inbound_token: row.inbound_token.presence || ENV["#{prefix}_INBOUND_TOKEN"].presence,
        options:       row.options || {}
      )
    end

    def default_system_type(system_key)
      Integrations::ExternalSystems.find(system_key)&.default_system_type.to_s
    end

    def env_prefix(system_key) = system_key.upcase

    private

    def find_or_create_row(system_key)
      find_or_create_by!(system_key: system_key) { |c| c.system_type = default_system_type(system_key) }
    end
  end

  def definition = Integrations::ExternalSystems.find(system_key)

  # 受信エンドポイントの Bearer。院内エージェントに配るので平文で読み出せる必要がある。
  def regenerate_inbound_token!
    update!(inbound_token: SecureRandom.urlsafe_base64(32))
    self.class.reset_cache!
    inbound_token
  end
end
