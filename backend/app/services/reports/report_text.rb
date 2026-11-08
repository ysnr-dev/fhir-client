module Reports
  # 帳票レンダラ共通の文字処理。
  module ReportText
    module_function

    # 長い行を桁数(半角換算。全角 = 2)で折り返す。継続行は全角空白 1 つで字下げして
    # 前の行の続きだと分かるようにする(文章の段落のように字下げが要らないときは indent: false)。
    # 折り返しを ThinReports 任せにせずここで済ませるのは、1 ページに入る行数(lines_per_page)
    # との対応を決定的にするため。
    def wrap(line, max_cols, indent: true)
      chunks = []
      current = +""
      cols = 0
      line.each_char do |char|
        width = char.ascii_only? ? 1 : 2
        if cols + width > max_cols
          chunks << current
          current = indent ? +"　" : +""
          cols = indent ? 2 : 0
        end
        current << char
        cols += width
      end
      chunks << current
      chunks
    end

    # レイアウト(.tlf のパス)内のアイテム ID を種類別に列挙する。未知の ID へ page.item すると
    # 例外になるため、設定対象を絞るのに使う。
    def layout_item_ids(layout_path)
      layout_item_ids_in(File.read(layout_path))
    end

    # .tlf の中身(JSON 文字列)から同じものを列挙する(DB に保存したレイアウト用)。
    # トップレベルのみで list の中は見ない。戻り値は [text-block の ID, image-block の ID,
    # ID を持つ全アイテム(text/ellipse 等を含む。表示切替の対象確認用)]。
    def layout_item_ids_in(tlf)
      items = JSON.parse(tlf).fetch("items", [])
      text_ids = Set.new
      image_ids = Set.new
      all_ids = Set.new
      items.each do |item|
        id = item["id"].to_s
        next if id.empty?

        all_ids << id
        case item["type"]
        when "text-block" then text_ids << id
        when "image-block" then image_ids << id
        end
      end
      [text_ids, image_ids, all_ids]
    end
  end
end
