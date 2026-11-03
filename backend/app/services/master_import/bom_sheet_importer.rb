require "csv"

module MasterImport
  # BOM(Basic Outcome Master®)の取込の共通部分。配布ファイルの列順・列名は版で変わりうるので、
  # ヘッダー行の見出し(表記ゆれを吸収した完全一致)で列を引き、Excel(.xlsx / .xls)と CSV の
  # どちらも受ける。全件洗い替え。
  #
  # サブクラスが宣言するもの:
  #   self.model    = Master::BomOutcome
  #   self.labels   = { outcome_code: %w[アウトカムコード], ... }   # 属性 ← 見出しの候補
  #   self.required = %i[outcome_code outcome_name]
  class BomSheetImporter
    Result = Struct.new(:imported_count, keyword_init: true)

    class_attribute :model, instance_accessor: false
    class_attribute :labels, instance_accessor: false, default: {}
    class_attribute :required, instance_accessor: false, default: []

    EXCEL_EXTENSIONS = %w[.xlsx .xls].freeze

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
    end

    def call
      rows = read_rows
      raise ImportError, "取り込める行がありません" if rows.empty?

      now = Time.current
      attrs = rows.map.with_index(1) do |row, index|
        row.merge(display_order: index, search_name: search_name(row), created_at: now, updated_at: now)
      end
      ActiveRecord::Base.transaction do
        self.class.model.delete_all
        attrs.each_slice(1000) { |slice| self.class.model.insert_all!(slice) }
      end
      Result.new(imported_count: attrs.size)
    end

    private

    attr_reader :file

    # 検索用の正規化。サブクラスが名称の列を指す。
    def search_name(_row)
      nil
    end

    def extension
      name = file.try(:original_filename) || file.try(:path)
      File.extname(name.to_s).downcase
    end

    def read_rows
      table = EXCEL_EXTENSIONS.include?(extension) ? excel_table : csv_table
      header, body = table
      columns = column_index(header)
      seen = {}
      body.each do |cells|
        row = columns.to_h { |attr, index| [attr, cells[index].to_s.strip.presence] }
        next if self.class.required.any? { |attr| row[attr].blank? }

        key = row[self.class.required.first]
        seen[key] ||= row
      end
      seen.values
    end

    # 見出し → 属性。必須の列が見つからなければ、どの見出しが要るかを示して止める。
    def column_index(header)
      normalized = header.map { |h| ExcelSource.normalize_label(h) }
      columns = {}
      self.class.labels.each do |attr, candidates|
        index = candidates.map { |c| ExcelSource.normalize_label(c) }.filter_map { |c| normalized.index(c) }.first
        columns[attr] = index if index
      end
      missing = self.class.required.reject { |attr| columns.key?(attr) }
      if missing.any?
        names = missing.map { |attr| self.class.labels[attr].first }.join("・")
        raise ImportError, "見出しの行に #{names} の列が見つかりません"
      end
      columns
    end

    def excel_table
      ExcelSource.open(file) do |workbook|
        sheet = workbook.sheet(0)
        header_row = ExcelSource.find_header_row(sheet, all_labels, limit: 20)
        raise ImportError, "見出しの行が見つかりません" unless header_row

        last_column = sheet.last_column.to_i
        header = (1..last_column).map { |column| ExcelSource.cell_string(sheet, header_row, column).to_s }
        body = ((header_row + 1)..sheet.last_row.to_i).map do |row|
          (1..last_column).map { |column| ExcelSource.cell_string(sheet, row, column) }
        end
        [header, body]
      end
    end

    def csv_table
      rows = CSV.parse(csv_text)
      header_index = rows.index { |cells| cells.any? { |c| all_labels.include?(ExcelSource.normalize_label(c)) } }
      raise ImportError, "見出しの行が見つかりません" unless header_index

      [rows[header_index].map(&:to_s), rows[(header_index + 1)..]]
    end

    def all_labels
      self.class.labels.values.flatten.map { |c| ExcelSource.normalize_label(c) }
    end

    # UTF-8(BOM の有無どちらも)なら そのまま、そうでなければ CP932 として読む。
    def csv_text
      raw = file.read
      utf8 = raw.dup.force_encoding("UTF-8")
      return utf8.delete_prefix("﻿") if utf8.valid_encoding?

      raw.force_encoding("CP932").encode("UTF-8", invalid: :replace, undef: :replace)
    end
  end
end
