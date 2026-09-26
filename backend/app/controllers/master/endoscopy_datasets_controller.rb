module Master
  # 内視鏡の実施入力用データセット。画面から手動で登録し、明細(手技料・薬剤・
  # 器材)は endoscopy_dataset_details で編集する。詳細では明細に参照先マスタの名称を
  # 添えて返すので、画面はコードだけを持てばよい。
  class EndoscopyDatasetsController < BaseController
    include DatasetActions
  end
end
