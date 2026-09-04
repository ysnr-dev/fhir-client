module MasterImport
  # 郵便番号マスタ(日本郵便 utf_ken_all.csv、UTF-8、ヘッダなし、15 列)。
  # 読みは全角カタカナ、括弧も全角(Shift_JIS 版の KEN_ALL.CSV とはここが違う)。
  #
  # 町域名には住所そのものではない注記が入る行がある。
  #   ・「以下に掲載がない場合」「○○の次に番地がくる場合」「○○一円」
  #   ・「（丁目）」「（○○を除く）」のような括弧書き
  # そのまま住所欄へ入れると誤った住所になるため、注記行は町域を空にし、
  # 括弧書きは取り除いて取り込む(郵便番号としては引けるように行自体は残す)。
  class PostalCodeImporter < CsvImporter
    self.model = Master::PostalCode
    self.encoding = :utf8
    self.columns = %i[
      jis_code old_postal_code postal_code
      prefecture_kana city_kana town_kana
      prefecture city town
      multiple_town_flag koaza_flag chome_flag multiple_code_flag
      update_flag update_reason
    ].freeze
    self.dropped_columns = %i[
      old_postal_code multiple_town_flag koaza_flag chome_flag multiple_code_flag
      update_flag update_reason
    ].freeze

    # 町域ではなく、その郵便番号の使い方を説明している行。
    TOWN_NOTES = /以下に掲載がない場合|の次に番地がくる場合|一円$/
    # 「（１〜１９丁目）」「（次のビルを除く）」など、住所には入れない括弧書き。
    TOWN_PARENTHESES = /（.*?）/
    # 読みの側の注記(漢字と同じ行を落とすため)。
    TOWN_KANA_NOTES = /イカニケイサイガナイバアイ|ノツギニバンチガクルバアイ|イチエン$/

    private

    def row_attrs(attrs, now)
      row = super
      row.merge(town: clean_town(row[:town]), town_kana: clean_town_kana(row[:town_kana]))
    end

    def clean_town(town)
      return "" if town.blank? || town.match?(TOWN_NOTES)

      town.gsub(TOWN_PARENTHESES, "")
    end

    # 読みも漢字と同じ形(注記行は落とし、括弧書きは取り除く)に揃える。
    def clean_town_kana(kana)
      return "" if kana.blank? || kana.match?(TOWN_KANA_NOTES)

      kana.gsub(TOWN_PARENTHESES, "")
    end
  end
end
