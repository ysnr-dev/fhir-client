# 上流 FHIR サーバーへの接続設定(SMART Backend Services / client_credentials)を
# 画面から編集できるようにするための単一行モデル。
#
# 値が入っていれば env より優先し、空なら env へフォールバックする。
class FhirConnectionSettings < ApplicationRecord
  # client_secret / fhir_admin_token はブラウザへ返さず、DB では暗号化して保持する。
  # 値で検索しないので非決定的(デフォルト)暗号化でよい。
  encrypts :client_secret
  # 上流の管理API(/admin/oauth_clients)用の共有トークン。FHIR の client_secret とは
  # 別物で、こちらは OAuth クライアントの発行・削除ができる強い権限を持つ。
  encrypts :fhir_admin_token

  # 単一行の強制: ガード列は常に 0。一意インデックス(migration)と合わせて 2 行目を弾く。
  attribute :singleton_guard, :integer, default: 0
  validates :singleton_guard, inclusion: { in: [0] }, uniqueness: true

  # DB 由来と env 由来をマージした実効設定。env のキー・デフォルトは
  # FhirTokenProvider / FhirGateway の現行値と完全一致させる。
  EffectiveConfig = Struct.new(
    :base_url, :client_id, :client_secret, :token_path, :host_header, :admin_token,
    keyword_init: true
  )

  # 実効設定は FHIR の中継 1 回ごとに読まれる(FhirGateway.new と FhirTokenProvider.default)ので、
  # 行をプロセス内に短時間だけ持って DB(Neon)への往復を省く。管理画面での保存は
  # 同じプロセスには reset_cache! で即時に、他のプロセスには TTL 経過後に反映される。
  CACHE_TTL = 30.seconds

  @cache_mutex = Mutex.new

  class << self
    # 単一行を遅延生成して返す。テストではトランザクションで行が巻き戻るのでキャッシュしない。
    def current
      return first_or_create! if Rails.env.test?

      @cache_mutex.synchronize do
        if @cached_row.nil? || @cached_at < CACHE_TTL.ago
          @cached_row = first_or_create!
          @cached_at = Time.current
        end
        @cached_row
      end
    end

    def reset_cache!
      @cache_mutex.synchronize do
        @cached_row = nil
        @cached_at = nil
      end
    end

    # env フォールバック込みの実効設定。
    def effective
      row = current
      EffectiveConfig.new(
        base_url:      row.base_url.presence      || ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000"),
        client_id:     row.client_id.presence     || ENV["FHIR_SERVER_CLIENT_ID"].presence,
        client_secret: row.client_secret.presence || ENV["FHIR_SERVER_CLIENT_SECRET"].presence,
        token_path:    row.token_path.presence    || "/oauth/token",
        host_header:   row.host_header.presence    || ENV["FHIR_SERVER_HOST_HEADER"],
        admin_token:   row.fhir_admin_token.presence || ENV["FHIR_ADMIN_TOKEN"].presence
      )
    end

    # 設定変更を検知するための単調マーカー。FhirTokenProvider.default が
    # これを見てシングルトンを作り直す(§実行時再設定)。
    def config_version
      current.updated_at.to_f
    end
  end
end
