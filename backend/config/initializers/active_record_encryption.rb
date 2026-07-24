# ActiveRecord Encryption の鍵設定。
# `FhirConnectionSettings#client_secret`（`encrypts`）の暗号化に使う。
#
# このリポジトリの他の設定と同様に env 駆動にする（credentials は使わない）。
# - 本番(Render)は 3 つの鍵を env で必須にする(render.yaml に sync:false で追加)。
# - 開発/テストはローカル限定の固定鍵にフォールバックする(実データを守る用途ではない)。
#
# 鍵を新規生成する場合は `bin/rails db:encryption:init` の出力を利用する。
Rails.application.configure do
  enc = config.active_record.encryption

  if Rails.env.production?
    enc.primary_key         = ENV.fetch("AR_ENCRYPTION_PRIMARY_KEY")
    enc.deterministic_key   = ENV.fetch("AR_ENCRYPTION_DETERMINISTIC_KEY")
    enc.key_derivation_salt = ENV.fetch("AR_ENCRYPTION_KEY_DERIVATION_SALT")
  else
    enc.primary_key         = ENV["AR_ENCRYPTION_PRIMARY_KEY"].presence         || "dev_primary_key_change_me_00000000"
    enc.deterministic_key   = ENV["AR_ENCRYPTION_DETERMINISTIC_KEY"].presence   || "dev_deterministic_key_change_00000"
    enc.key_derivation_salt = ENV["AR_ENCRYPTION_KEY_DERIVATION_SALT"].presence || "dev_key_derivation_salt_change_0000"
  end
end
