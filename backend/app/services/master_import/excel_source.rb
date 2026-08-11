require "roo"
require "roo-xls"
require "tempfile"

module MasterImport
  # アップロードされた配布 Excel を Roo で開く。JJ1017 の別表は Ver3.3 の配布時点で
  # 5ファイル中4ファイルが旧 .xls 形式のため、.xlsx と両方を扱えるようにしている。
  module ExcelSource
    WORKBOOK_CLASSES = {
      ".xlsx" => Roo::Excelx,
      ".xls" => Roo::Excel
    }.freeze

    module_function

    def open(file)
      # アップロードされたファイルは元のファイル名から、テストなどで渡される
      # 素の File はパスから拡張子を見る。
      name = file.try(:original_filename) || file.try(:path)
      extension = File.extname(name.to_s).downcase
      workbook_class = WORKBOOK_CLASSES[extension]
      raise ImportError, "Excel ファイル(.xls / .xlsx)を選んでください" if workbook_class.nil?

      Tempfile.create(["master_import", extension], binmode: true) do |tmp|
        tmp.write(file.read)
        tmp.flush
        yield workbook_class.new(tmp.path)
      end
    end

    # セルの値を文字列にする。Roo は数値セルを Float で返すため、整数のものは
    # 小数点以下を落とす(整理番号の "1.0" → "1"、コード値の "100.0" → "100")。
    def cell_string(sheet, row, column)
      value = sheet.cell(row, column)
      text =
        case value
        when nil then ""
        when Float then value == value.to_i ? value.to_i.to_s : value.to_s
        else value.to_s
        end
      text.strip.presence
    end

    # ヘッダー行を探す。labels のいずれかに完全一致するセルを持つ最初の行を返す。
    def find_header_row(sheet, labels, limit: 10)
      (1..[sheet.last_row.to_i, limit].min).find do |row|
        (1..sheet.last_column.to_i).any? do |column|
          labels.include?(normalize_label(cell_string(sheet, row, column)))
        end
      end
    end

    # ヘッダーの表記ゆれ(全角括弧・空白・改行)を吸収する。
    def normalize_label(text)
      text.to_s.unicode_normalize(:nfkc).gsub(/[[:space:]]/, "")
    end

    # "Ver.6.1" のような版シートのうち、版番号が最も新しいものを選ぶ。
    # "Ver.3.0、3.1" のように複数版が相乗りしたシートは、その中の最大値で比べる。
    def latest_version_sheet(workbook)
      candidates = workbook.sheets.filter_map do |name|
        next unless /ver/i.match?(name)

        versions = name.scan(/\d+(?:\.\d+)*/)
        next if versions.empty?

        [name, versions.map { |v| Gem::Version.new(v) }.max]
      end
      raise ImportError, "版(Ver.x.x)のシートが見つかりません" if candidates.empty?

      candidates.max_by(&:last).first
    end
  end
end
