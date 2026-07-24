# 上流 FHIR サーバーへの接続設定(SMART Backend Services / client_credentials)を
# 画面から編集できるようにするための単一行モデル。
#
# 値が入っていれば env より優先し、空なら env(現行のデフォルト)へフォールバックする。
# これにより未設定のデプロイは従来と完全に同じ挙動になる。
class FhirConnectionSettings < ApplicationRecord
  # client_secret はブラウザへ返さず、DB では暗号化して保持する。値で検索しないので
  # 非決定的(デフォルト)暗号化でよい。
  encrypts :client_secret

  # 単一行の強制: ガード列は常に 0。一意インデックス(migration)と合わせて 2 行目を弾く。
  attribute :singleton_guard, :integer, default: 0
  validates :singleton_guard, inclusion: { in: [0] }, uniqueness: true

  # DB 由来と env 由来をマージした実効設定。env のキー・デフォルトは
  # FhirTokenProvider / FhirGateway の現行値と完全一致させる。
  EffectiveConfig = Struct.new(
    :base_url, :client_id, :client_secret, :token_path, :host_header,
    keyword_init: true
  )

  class << self
    # 単一行を遅延生成して返す。
    def current
      first_or_create!
    end

    # env フォールバック込みの実効設定。
    def effective
      row = current
      EffectiveConfig.new(
        base_url:      row.base_url.presence      || ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000"),
        client_id:     row.client_id.presence     || ENV["FHIR_SERVER_CLIENT_ID"].presence,
        client_secret: row.client_secret.presence || ENV["FHIR_SERVER_CLIENT_SECRET"].presence,
        token_path:    row.token_path.presence    || "/oauth/token",
        host_header:   row.host_header.presence    || ENV["FHIR_SERVER_HOST_HEADER"]
      )
    end

    # 設定変更を検知するための単調マーカー。FhirTokenProvider.default が
    # これを見てシングルトンを作り直す(§実行時再設定)。
    def config_version
      current.updated_at.to_f
    end
  end
end
