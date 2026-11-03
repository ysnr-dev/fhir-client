require "csv"

module MasterImport
  # BOM(Basic Outcome Master®)の取込の共通部分。配布ファイルの列順・列名は版で変わりうるので、
  # ヘッダー行の見出し(表記ゆれを吸収した完全一致)で列を引き、Excel(.xlsx / .xls)と CSV の
  # どちらも受ける。Excel は**必須の見出しを持つシートをすべて読んで合わせる**(配布ファイルは本体の
  # シートと、版の追加・修正分の「Others_*」シートに分かれている)。同じコードは先に出た行を残す。全件洗い替え。
  #
  # サブクラスが宣言するもの:
  #   self.model    = Master::BomOutcome
  #   self.labels   = { outcome_code: %w[アウトカムコード], ... }   # 属性 ← 見出しの候補
  #   self.required = %i[outcome_code outcome_name]                 # 先頭が重複を見るキー
  #   self.columns  = %i[...]                                       # model に入れる属性(labels の一部)
  class BomSheetImporter
    Result = Struct.new(:imported_count, keyword_init: true)

    class_attribute :model, instance_accessor: false
    class_attribute :labels, instance_accessor: false, default: {}
    class_attribute :required, instance_accessor: false, default: []
    class_attribute :columns, instance_accessor: false, default: []

    EXCEL_EXTENSIONS = %w[.xlsx .xls].freeze
    # 配布ファイルは「該当なし」をハイフンで表す。空にして持つ。
    BLANK_MARKS = ["-", "‐", "―", "ー", "－", "—"].freeze

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
    end

    def call
      all_rows = read_rows
      key = self.class.required.first
      rows = all_rows.each_with_object({}) { |row, seen| seen[row[key]] ||= row }.values
      raise ImportError, "取り込める行がありません" if rows.empty?

      now = Time.current
      # 表(シート)ごとに列が違うので、無い列は nil で揃える(insert_all! は全行で同じキーが要る)。
      attrs = rows.map.with_index(1) do |row, index|
        self.class.columns.to_h { |column| [column, row[column]] }
            .merge(display_order: index, search_name: search_name(row), created_at: now, updated_at: now)
      end
      ActiveRecord::Base.transaction do
        self.class.model.delete_all
        attrs.each_slice(1000) { |slice| self.class.model.insert_all!(slice) }
        import_extra(all_rows, now)
      end
      Result.new(imported_count: attrs.size)
    end

    private

    attr_reader :file

    # 検索用の正規化。サブクラスが名称の列を指す。
    def search_name(_row)
      nil
    end

    # 本体以外に取り込むもの(OAT の組など)。全シートの行(重複を除く前)を受ける。
    def import_extra(_rows, _now); end

    def extension
      name = file.try(:original_filename) || file.try(:path)
      File.extname(name.to_s).downcase
    end

    # 見出しの合うシート(CSV は 1 表)の行を、属性名のハッシュにして順に並べる。
    # 見出しの合う列が多い表を先にする(観察項目は本体の組み合わせシートにも載るが、分類を持つ
    # 「観察項目マスター」の行を残したい。同じ数ならブックの並び順)。
    def read_rows
      tables = EXCEL_EXTENSIONS.include?(extension) ? excel_tables : [csv_table]
      ordered = tables.map { |header, body| [column_index(header), body] }
                      .sort_by.with_index { |(columns, _), index| [-columns.size, index] }
      rows = ordered.flat_map do |columns, body|
        body.filter_map do |cells|
          row = columns.to_h { |attr, index| [attr, clean(cells[index])] }
          row if self.class.required.all? { |attr| row[attr].present? }
        end
      end
      raise ImportError, "見出しの行に #{required_label_names} の列が見つかりません" if tables.empty?

      rows
    end

    def clean(value)
      text = value.to_s.strip
      text.blank? || BLANK_MARKS.include?(text) ? nil : text
    end

    def required_label_names
      self.class.required.map { |attr| self.class.labels[attr].first }.join("・")
    end

    # 見出し → 列番号(0 始まり)。必須の列がすべて揃うときだけ表として扱う(揃わなければ nil)。
    def column_index(header)
      normalized = header.map { |h| ExcelSource.normalize_label(h) }
      columns = {}
      self.class.labels.each do |attr, candidates|
        index = candidates.map { |c| ExcelSource.normalize_label(c) }.filter_map { |c| normalized.index(c) }.first
        columns[attr] = index if index
      end
      self.class.required.all? { |attr| columns.key?(attr) } ? columns : nil
    end

    # 必須の見出しを持つシートをすべて(ブックの並び順で)。
    def excel_tables
      ExcelSource.open(file) do |workbook|
        workbook.sheets.filter_map do |name|
          sheet = ExcelSource::SheetValues.new(workbook, name)
          header_row = ExcelSource.find_header_row(sheet, all_labels, limit: 20)
          next unless header_row

          last_column = sheet.last_column.to_i
          header = (1..last_column).map { |column| ExcelSource.cell_string(sheet, header_row, column).to_s }
          next unless column_index(header)

          body = ((header_row + 1)..sheet.last_row.to_i).map do |row|
            (1..last_column).map { |column| ExcelSource.cell_string(sheet, row, column) }
          end
          [header, body]
        end
      end
    end

    def csv_table
      rows = CSV.parse(csv_text)
      header_index = rows.index { |cells| column_index(cells.map(&:to_s)) }
      raise ImportError, "見出しの行に #{required_label_names} の列が見つかりません" unless header_index

      [rows[header_index].map(&:to_s), rows[(header_index + 1)..]]
    end

    def all_labels
      self.class.labels.values.flatten.map { |c| ExcelSource.normalize_label(c) }
    end

    # UTF-8(BOM の有無どちらも)ならそのまま、そうでなければ CP932 として読む。
    def csv_text
      raw = file.read
      utf8 = raw.dup.force_encoding("UTF-8")
      return utf8.delete_prefix("﻿") if utf8.valid_encoding?

      raw.force_encoding("CP932").encode("UTF-8", invalid: :replace, undef: :replace)
    end
  end
end
