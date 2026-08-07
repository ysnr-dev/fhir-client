# 休眠(Render 無料枠は ~15 分アイドルでスピンダウンする)からの明示的な起こし用。
#
# このアクションが実行できている時点で backend は起きている。上流 FHIR サーバーは
# 短いタイムアウトで /up を叩き、「その瞬間の可否」だけを返す。起きるまで待ち切らない
# のは、コールドスタートは 1 分を超えることがあり、長時間ぶら下がったリクエストは
# ゲートウェイのタイムアウトに当たるため。待ちはクライアント側のポーリング(WakeButton)。
#
# 上流を「起こす」役は backend ではなくブラウザが担う(upstream_probe_url を参照)。
class WakeupController < ActionController::API
  # 1 回のプローブに与える時間。上流が起動中でも待たずに切り上げる。
  PROBE_TIMEOUT = 5

  def show
    config = effective_config
    render json: {
      backend: "ready",
      upstream: upstream_state(config),
      upstream_probe_url: probe_url(config)
    }
  end

  private

  # 上流を起こすためにブラウザから直接叩いてもらう URL。
  #
  # backend(Render 上のサービス)から *.onrender.com を叩くと内部経路に落ちるらしく、
  # スピンダウン中のインスタンスの起動トリガーにならない。実測では上流がコールドの間
  # プローブは open_timeout(2 秒)にも達せず即失敗し、2 分叩き続けても上流は起きなかった。
  # 一方、外部クライアント(ブラウザや手元の curl)から同じ URL を叩くとゲートウェイが
  # リクエストを保留して起動が走り、~45 秒で 200 を返すようになる。
  # そこで起こす役はブラウザに渡し、backend は可否の判定だけを受け持つ。
  #
  # 設定行が引けなくても env から組み立てる。判定はできなくても「起こす」ことは
  # できたほうがよいため。
  def probe_url(config)
    base = config&.base_url.presence || ENV["FHIR_SERVER_BASE_URL"].presence
    return nil if base.blank?

    "#{base.to_s.chomp('/')}/up"
  end

  def upstream_state(config)
    return "waking" if config.nil?

    connection = UpstreamWarmup.probe_connection(config.base_url, config.host_header, timeout: PROBE_TIMEOUT)
    UpstreamWarmup.ready?(connection) ? "ready" : "waking"
  end

  # 設定行が引けない(DB が寝ている等)ときも「起こしボタン」は壊さない。
  def effective_config
    FhirConnectionSettings.effective
  rescue StandardError => e
    Rails.logger.warn("[Wakeup] 接続設定を読めませんでした: #{e.class}: #{e.message}")
    nil
  end
end
