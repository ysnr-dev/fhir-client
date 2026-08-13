require "csv"

module MasterImport
  # Parses the medical material master CSV (t_ALL*.csv, no header row, 38 columns)
  # and replaces master_medical_materials wholesale within one transaction.
  #
  # レイアウトは診療報酬情報提供サービスの「ファイルレイアウト」(R08rec3.pdf)
  # 〈特定器材マスター〉の項番順。予備(未使用)の項目も落とさず取り込む。
  class MedicalMaterialImporter
    EXPECTED_COLUMNS = 38
    # 項番17・18はレコード仕様上「予備(未使用)」。実データでは改定前の金額種別・金額が
    # 残っている行があるが、仕様が未使用と定める以上これを算定には使わない
    # (医薬品マスターと違い、旧金額として定義されていない)。
    COLUMNS = %i[
      change_category master_type material_code
      name_kanji_length name name_kana_length name_kana
      unit_code unit_name_length unit_name
      price_type price
      reserve1 age_addition_category lower_age_limit upper_age_limit
      reserve2 reserve3
      name_change_flag kana_change_flag oxygen_category material_category
      price_cap_flag price_cap_points
      reserve4 publication_order abolition_related_code
      changed_on transitional_measure_on abolished_on
      notification_table_number notification_section_number dpc_category
      reserve5 reserve6 reserve7
      basic_name remanufactured_single_use_device
    ].freeze
    DECIMAL_COLUMNS = %i[price].freeze

    Result = Struct.new(:imported_count, keyword_init: true)

    def self.call(file)
      new(file).call
    end

    def initialize(file)
      @file = file
    end

    def call
      rows = parse_rows

      ActiveRecord::Base.transaction do
        Master::MedicalMaterial.delete_all
        rows.each_slice(1000) { |slice| Master::MedicalMaterial.insert_all!(slice) }
      end

      Result.new(imported_count: rows.size)
    end

    private

    attr_reader :file

    def parse_rows
      now = Time.current
      csv_text = file.read.force_encoding("CP932").encode("UTF-8")

      CSV.parse(csv_text, headers: false).map.with_index do |row, index|
        values = row.to_a

        if values.size != EXPECTED_COLUMNS
          raise ImportError, "row #{index + 1}: expected #{EXPECTED_COLUMNS} columns, got #{values.size}"
        end

        attrs = COLUMNS.zip(values).to_h
        # 空文字のまま decimal 列へ入れると型変換で落ちるので nil に寄せる。
        DECIMAL_COLUMNS.each { |col| attrs[col] = attrs[col].presence }
        # insert_all! はモデルのコールバックを通らないため、検索用カラムはここで埋める。
        attrs[:search_name] = Master::SearchNormalizer.normalize(attrs[:name])
        attrs[:search_kana] = Master::SearchNormalizer.normalize(attrs[:name_kana])
        attrs.merge(created_at: now, updated_at: now)
      end
    end
  end
end
