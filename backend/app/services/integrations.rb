# 連携先が何であっても同じ意味になる失敗。呼び側はこれだけを見る。
module Integrations
  class Error < StandardError; end
  # 接続設定が入っていない。画面に「設定してください」と出す。
  class NotConfigured < Error; end
  # 繋がらない・応答しない。待てば直るかもしれないもの。
  class Unreachable < Error; end
  # 繋がったが連携先が受け付けなかった。
  class Rejected < Error; end
  # 連携先にその患者・伝票が無い。
  class NotFound < Error; end
end
