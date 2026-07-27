# 休眠(Render 無料枠は ~15 分アイドルでスピンダウンする)からの明示的な起こし用。
#
# このアクションが実行できている時点で backend は起きている。上流 FHIR サーバーは
# 短いタイムアウトで /up を叩き、起動のきっかけを与えたうえで「その瞬間の可否」だけを
# 返す。起きるまで待ち切らないのは、コールドスタートは 1 分を超えることがあり、
# 長時間ぶら下がったリクエストはゲートウェイのタイムアウトに当たるため。
# 待ちはクライアント側のポーリング(WakeButton)に任せる。
class WakeupController < ActionController::API
  # 1 回のプローブに与える時間。上流が起動中でも待たずに切り上げる。
  PROBE_TIMEOUT = 5

  def show
    render json: { backend: "ready", upstream: upstream_state }
  end

  private

  def upstream_state
    config = FhirConnectionSettings.effective
    connection = UpstreamWarmup.probe_connection(config.base_url, config.host_header, timeout: PROBE_TIMEOUT)
    UpstreamWarmup.ready?(connection) ? "ready" : "waking"
  rescue StandardError
    # 設定行が引けない等で落ちても「起こしボタン」を壊さない。上流は不明扱い。
    "waking"
  end
end
