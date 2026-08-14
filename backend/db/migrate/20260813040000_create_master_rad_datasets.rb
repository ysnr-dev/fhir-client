class CreateMasterRadDatasets < ActiveRecord::Migration[8.0]
  # 放射線検査の実施入力用データセット。実施入力で毎回登録することになる
  # 手技料(医科診療行為)・造影剤(医薬品)・放射線器材の組み合わせに名前を付けて
  # まとめたもので、撮影項目マスタ(master_rad_items)に紐付けておくと、
  # 実施入力モーダルの初期明細として展開される。
  #
  # 撮影項目そのものに持たせず別マスタにしたのは、同じ組み合わせ(例: 造影CTの
  # 標準セット)が複数の撮影項目で使い回されるため。項目ごとに書くと造影剤を
  # 変えたときに全項目を直すことになる。
  def change
    create_table :master_rad_datasets do |t|
      t.string :dataset_code, null: false  # 施設内のデータセットコード(自動採番可)
      t.string :name, null: false          # データセット名(例: 造影CT標準セット)
      t.string :name_kana                  # カナ(検索用)
      t.date :valid_from                   # 運用開始日
      t.date :valid_to                     # 運用終了日
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_rad_datasets, :dataset_code, unique: true
  end
end
