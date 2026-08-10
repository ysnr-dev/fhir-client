class CreateMasterRadJj1017Codes < ActiveRecord::Migration[8.0]
  # JJ1017(画像検査オーダーコード規格)の部品コード表。手技・部位・体位・撮影方向
  # などの要素を、要素名(element)で区別して1テーブルにまとめて持つ。
  #
  # 全要素が「コード・名称・英語名・Ver・備考」という同じ形をしているため、
  # 要素ごとにテーブル・モデル・API・画面を11本並べる意味がない。部位だけ
  # 大部位/臓器系/モダリティ別使用可否を持つので、そこだけ nullable 列を足している。
  #
  # 施設独自の拡張コードも source=local として同じテーブルに入れる。配布ファイルの
  # 取込は source=official の行だけを洗い替えるので、拡張コードは消えない。
  def change
    create_table :master_rad_jj1017_codes do |t|
      # 要素名。Master::Jj1017Code::ELEMENT_NAMES のいずれか
      # (modality / procedure_major / procedure_minor / procedure_extension /
      #  body_part / laterality / body_position / direction /
      #  detail_position / special_instruction / nuclide)。
      t.string :element, null: false
      # 要素ごとに桁数が違う(1〜3桁)。32桁コードにはこの値がそのまま埋め込まれる。
      t.string :code, null: false
      t.string :name, null: false     # コード意味(和名)
      t.string :name_english          # コード意味(英語)。部位と一部の手技のみ
      # 通称名称。別表1D(手技拡張)の核医学領域頻用名(11C-CH3COOH → 11C-酢酸)。
      t.string :common_name
      t.string :jj_version            # 収載バージョン(別表の Ver 列)
      t.text :note                    # 備考
      # official = 配布ファイル由来(取込で洗い替え) / local = 施設独自の拡張コード。
      t.string :source, null: false, default: "official"
      t.integer :display_order        # 別表の掲載順(整理番号)

      # ここから element="body_part" のときだけ使う列。別表2の部位コードは
      # 「大部位(2桁).臓器系部位(1桁).小部位(3桁)」の6桁構造だが、32桁コードに
      # 乗るのは小部位3桁だけ。上位2つは意味の理解と選択UIの絞り込みに使う。
      t.string :major_part_code
      t.string :organ_system_code
      # 別表2のモダリティ別使用可否(一般撮影系 / CT / MR / US)。部位選択の
      # 候補を撮影種別で絞るために持つ。
      t.boolean :use_general, null: false, default: false
      t.boolean :use_ct, null: false, default: false
      t.boolean :use_mr, null: false, default: false
      t.boolean :use_us, null: false, default: false

      # 検索用。SearchNormalizer で正規化した値を保存時にセットする。
      t.string :search_name

      t.timestamps
    end

    add_index :master_rad_jj1017_codes, %i[element code], unique: true,
              name: "index_rad_jj1017_codes_on_element_and_code"
    add_index :master_rad_jj1017_codes, :search_name
  end
end
