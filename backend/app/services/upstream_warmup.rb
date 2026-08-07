require "faraday"

# 上流 FHIR サーバー(Render 無料枠)のコールドスタート待ち。
#
# 無料枠は ~15 分アイドルでスピンダウンし、最初のリクエストで起動に ~50 秒
# (それ以上のことも)かかる。その間ゲートウェイはリクエストを保留するか
# 502/503/504 を返す。認証されていない /up が 2xx を返すまでポーリングして
# 「本当に起きた」ことを確認してから本題のリクエストを投げる。
#
# FhirTokenProvider(トークン取得の前に常に待つ)と FhirAdminGateway(まず投げて、
# transient 失敗のときだけ待つ)で共有する。ベストエフォートで例外は投げない
# -- 起きてこなければ呼び出し側のリクエストが失敗として現れる。
module UpstreamWarmup
  # コールドな Render は起動完了まで /up を保留し得るので、1 回のプローブに
  # 起動時間まるごとを与える。
  PROBE_TIMEOUT = 90
  # ゲートウェイが /up を保留せず 502/503 で即座に落とす場合のための上限
  # (この間隔で ~60 秒)。
  MAX_ATTEMPTS = 20
  POLL_INTERVAL = 3

  module_function

  def wait_until_ready(base_url:, host_header: nil, sleeper: ->(seconds) { sleep(seconds) })
    connection = probe_connection(base_url, host_header, timeout: PROBE_TIMEOUT)

    MAX_ATTEMPTS.times do |attempt|
      return true if ready?(connection)

      sleeper.call(POLL_INTERVAL) unless attempt == MAX_ATTEMPTS - 1
    end
    false
  end

  # 失敗理由は握り潰さずログに残す。ここが黙って false を返していたせいで、
  # 「上流が起きない」原因(backend からのプローブが起動トリガーにならないこと)が
  # 本番のログから一切見えなかった。
  def ready?(connection)
    connection.get.success?
  rescue StandardError => e
    Rails.logger.info("[UpstreamWarmup] プローブ失敗: #{e.class}: #{e.message}")
    false
  end

  # timeout はプローブ 1 回あたりの待ち時間。起動を待ち切りたい呼び出し
  # (wait_until_ready)は PROBE_TIMEOUT を、待たずに現況だけ知りたい呼び出し
  # (WakeupController)は短い値を渡す。
  def probe_connection(base_url, host_header, timeout: PROBE_TIMEOUT)
    Faraday.new(url: "#{base_url.to_s.chomp('/')}/up") do |f|
      f.options.open_timeout = 2
      f.options.timeout = timeout
      f.headers["Host"] = host_header if host_header.present?
      f.adapter Faraday.default_adapter
    end
  end
end
