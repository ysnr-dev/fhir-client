module Master
  # 実施入力用データセットの明細(手技料・薬剤・器材)。データセットの詳細画面から
  # 編集し、実施入力モーダルからは複数データセット分をまとめて読む。
  class TreatmentDatasetDetailsController < BaseController
    include DatasetDetailActions
  end
end
