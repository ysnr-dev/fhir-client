class CreateMasterRadItems < ActiveRecord::Migration[8.0]
  # 放射線オーダー項目マスタ。医師がオーダー画面で選ぶ単位の検査項目で、
  # 画面から手動で登録・メンテナンスする。検体検査の master_lab_order_items に
  # あたる。セットの構成は master_rad_set_items が持つ。
  #
  # JJ1017 の各要素はコードで master_rad_jj1017_codes に緩く紐づける
  # (外部キーは張らない)。要素から組み立てた32桁コードは jj1017_code に持つ。
  def change
    create_table :master_rad_items do |t|
      t.string :item_code, null: false # 独自採番の項目コード
      t.string :name, null: false      # 項目名称
      t.string :short_name             # 略称
      t.string :name_kana              # カナ名称。検索用の入力元
      # single = 単項目 / set = 複数の単項目をまとめて依頼するもの。
      # 検体検査のパネルと同じ考え方だが、放射線では「セット」と呼ぶ。
      t.string :kind, null: false, default: "single"

      # --- JJ1017 の要素(桁数は Master::Jj1017Code::ELEMENTS が持つ) ---
      t.string :modality_code             # 種別(モダリティ) 1桁
      t.string :procedure_major_code      # 手技(大分類) 2桁
      t.string :procedure_minor_code      # 手技(小分類) 2桁
      t.string :procedure_extension_code  # 手技(拡張) 2桁
      t.string :body_part_code            # 部位(小部位) 3桁
      t.string :laterality_code           # 左右等 1桁
      t.string :body_position_code        # 姿勢体位 1桁
      t.string :direction_code            # 入射・撮影方向・撮影法 2桁
      t.string :detail_position_code      # 詳細体位 2桁
      t.string :special_instruction_code  # 特殊指示 2桁
      t.string :nuclide_code              # 核種(線種) 2桁
      # 15〜16桁目の拡張(汎用)。部品コード表を持たない共通拡張領域。
      t.string :generic_extension_code
      # 上の要素から組み立てた JJ1017-32(32桁)。未指定の要素は 0 で埋める。
      # 保存のたびに再生成する導出値だが、一覧表示・頻用コードからの一括作成時の
      # 重複判定・将来のオーダー送出で毎回組み立てないよう列に持つ。
      # kind=set は要素を持たないので NULL。
      t.string :jj1017_code

      t.date :valid_from               # 有効開始日
      t.date :valid_to                 # 有効終了日。期限を過ぎた項目は選択肢に出さない
      t.string :receipt_code           # レセ電算コード。将来の会計連携用
      t.integer :display_order
      t.text :note

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name
      t.string :search_short_name
      t.string :search_kana

      t.timestamps
    end

    add_index :master_rad_items, :item_code, unique: true
    add_index :master_rad_items, :jj1017_code
    add_index :master_rad_items, :kind
    add_index :master_rad_items, :modality_code

    # セット(1オーダー → 複数の撮影)の構成。master_rad_items.item_code で
    # 緩く紐づける(外部キーは張らない)。
    create_table :master_rad_set_items do |t|
      t.string :set_item_code, null: false
      t.string :member_item_code, null: false
      t.integer :display_order
      t.text :note

      t.timestamps
    end

    add_index :master_rad_set_items, %i[set_item_code member_item_code],
              unique: true, name: "index_rad_set_items_on_set_and_member"
    add_index :master_rad_set_items, :member_item_code
  end
end
