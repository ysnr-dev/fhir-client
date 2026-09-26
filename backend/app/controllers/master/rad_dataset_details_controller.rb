module Master
  # 実施入力用データセットの明細(手技料・造影剤・器材)。データセットの詳細画面から
  # 編集し、実施入力モーダルからは複数データセット分をまとめて読む。
  class RadDatasetDetailsController < BaseController
    include DatasetDetailActions
  end
end
