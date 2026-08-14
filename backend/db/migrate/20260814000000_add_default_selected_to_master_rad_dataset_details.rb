class AddDefaultSelectedToMasterRadDatasetDetails < ActiveRecord::Migration[8.0]
  # 実施入力を開いたときに、この明細を最初から並べるか。
  #
  # データセットには「造影 CT なら必ず使う造影剤」と「使うこともある器材」が混在する。
  # 前者だけを初期値にしておけば、実施入力は既定のまま登録でき、後者は実際に使った
  # ときだけ検索して足せばよい。
  #
  # 既定を true にしているのは、データセットに積む明細は「通常使うもの」が大半で、
  # 例外の方をチェックで外す運用の方が手数が少ないため。
  def change
    add_column :master_rad_dataset_details, :default_selected, :boolean, null: false, default: true
  end
end
