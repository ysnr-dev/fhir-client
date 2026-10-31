require "csv"

module MasterImport
  # 採用区分の一括取込(薬剤付加情報の adoption)。CSV はヘッダあり・2 列(医薬品コード, 採用区分)。
  # 採用区分は画面の表示名(採用・仮採用・院外専用・採用外・空)か値(adopted など)で書く。
  # 文字コードは UTF-8(BOM 可)か Shift_JIS。載っている薬だけを書き換え、ほかの項目と載っていない薬には触れない。
  class MedicineAdoptionImporter
    Result = Struct.new(:imported_count, :skipped_count, keyword_init: true)

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
    end

    def call
      rows = parse
      raise ImportError, "採用区分の行がありません" if rows.empty?

      known = Master::Medicine.where(medicine_code: rows.keys).pluck(:medicine_code).to_set
      targets = rows.select { |code, _| known.include?(code) }
      records = Master::MedicineAttribute.where(medicine_code: targets.keys).index_by(&:medicine_code)

      ActiveRecord::Base.transaction do
        targets.each do |code, category|
          record = records[code] || Master::MedicineAttribute.new(medicine_code: code)
          record.settings = (record.settings || {}).merge("adoption" => category)
          record.save!
        end
      end

      Result.new(imported_count: targets.size, skipped_count: rows.size - targets.size)
    end

    private

    def categories
      @categories ||= Master::MedicineAttribute::ATTRIBUTES["adoption"][:options].flat_map do |option|
        [[option[:value], option[:value]], [option[:label], option[:value]]]
      end.to_h.merge("" => "unset")
    end

    def parse
      CSV.parse(read_text, headers: true).each_with_index.to_h do |row, index|
        code, label = row.fields.map { |v| v.to_s.strip }
        raise ImportError, "row #{index + 2}: 医薬品コードがありません" if code.blank?

        category = categories[label.to_s]
        raise ImportError, "row #{index + 2}: 採用区分が読めません(#{label})" unless category

        [code, category]
      end
    end

    def read_text
      raw = @file.read
      utf8 = raw.dup.force_encoding("UTF-8")
      text = utf8.valid_encoding? ? utf8 : raw.force_encoding("CP932").encode("UTF-8")
      text.delete_prefix("﻿")
    rescue Encoding::UndefinedConversionError, Encoding::InvalidByteSequenceError
      raise ImportError, "UTF-8 か Shift_JIS の CSV ではありません"
    end
  end
end
