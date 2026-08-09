class CreateMasterLabOrderItems < ActiveRecord::Migration[8.0]
  # 検体検査オーダー項目。医師がオーダー画面で選ぶ単位の検査項目で、
  # 画面から手動で登録・メンテナンスする。パネルの構成は master_lab_panel_items が持つ。
  #
  # 参照テーブルの master_lab_items(共有項目JLACコードマスタ)とは役割が異なる。
  # あちらは配布ファイルそのままの結果報告用17桁コード、こちらはオーダー用の項目。
  def change
    create_table :master_lab_order_items do |t|
      t.string :order_item_code, null: false # 独自採番の検査項目コード
      t.string :name, null: false            # 検査項目名称
      t.string :short_name                   # 略称(CRP / HbA1c など)
      t.string :name_kana                    # カナ名称(シーアールピー など)。検索用の入力元
      # 検査分野(生化学検査 / 血液学的検査 / 免疫学的検査 など)。
      t.string :category
      # 検体(master_lab_specimens.specimen_code)。コードで緩く紐づけ、外部キーは張らない。
      t.string :specimen_code
      # 採取管(master_lab_containers.container_code)。空なら検体マスタの既定採取管を使う。
      # 検体の既定と異なる採取管を使う項目だけ設定する上書き列。
      t.string :container_code
      # single = 単項目 / panel = 複数項目をまとめて依頼するもの(末梢血液一般検査など)
      t.string :kind, null: false, default: "single"
      # 標準コード。master_lab_items から検索して設定する(JLAC11 17桁 または JLAC10)。
      # JLAC11 の17桁は試薬・機器の販売名単位のため、ここには代表コードを1つ選んで入れる。
      t.string :jlac_code
      # jlac_code の体系(jlac10 | jlac11)。FHIR 出力時の Coding.system と
      # 電子カルテ情報共有サービスの system 識別子4区分の判別に使う。
      t.string :jlac_code_system
      t.date :valid_from                     # 有効開始日
      t.date :valid_to                       # 有効終了日。期限を過ぎた項目は選択肢に出さない
      # 実施区分(in_house = 院内 / outsourced = 外注)。採取後の検体の行き先が変わる。
      t.string :execution_type
      t.string :receipt_code                 # レセ電算コード。将来の会計連携用
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_short_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_lab_order_items, :order_item_code, unique: true
    add_index :master_lab_order_items, :jlac_code
    add_index :master_lab_order_items, :kind
  end
end
