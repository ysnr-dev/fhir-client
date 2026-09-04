class CreateMasterPostalCodes < ActiveRecord::Migration[8.0]
  # 郵便番号マスタ。日本郵便の住所の郵便番号(utf_ken_all.csv)を取り込み、患者登録などで
  # 郵便番号から都道府県・市区町村・町域を埋めるために引く。
  #
  # 郵便番号は一意ではない(1 つの番号が複数の町域を表すことがある)ので、
  # 索引は非一意。町域名の「以下に掲載がない場合」などの注記行は取込時に
  # 町域を空にして入れる(番号としては引けるようにするため)。
  def change
    create_table :master_postal_codes do |t|
      t.string :postal_code, null: false # 郵便番号(7桁、ハイフン無し)
      t.string :jis_code                 # 全国地方公共団体コード(5桁)
      t.string :prefecture, null: false  # 都道府県名
      t.string :city, null: false        # 市区町村名
      t.string :town, null: false, default: "" # 町域名(注記行は空)
      t.string :prefecture_kana
      t.string :city_kana
      t.string :town_kana

      t.timestamps
    end

    add_index :master_postal_codes, :postal_code
  end
end
