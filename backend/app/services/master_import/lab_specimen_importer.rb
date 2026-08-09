require "roo"
require "tempfile"
require "zip"
require "nokogiri"

module MasterImport
  # JLAC11 材料コード一覧(jlac11_1_1.0.xlsx)の「材料コード」シートから
  # master_lab_specimens へ取り込む。
  #
  # 他マスタと違い全件洗い替えにしない。略称・既定採取管・備考は画面から
  # 手入力する列のため、配布ファイル由来の列だけを specimen_code キーで
  # upsert し、手入力済みの値を保全する。
  #
  # シートの構造:
  # - A列: ◆付きのグループ見出し(尿・便 / 血液 など)。以降の行の検体分類になる。
  # - D列: 材料名。先頭の全角空白の数が階層(尿 > 自然排尿)。セルのルビが読みがな。
  # - E列: 旧体系(JLAC10)の材料コード。
  # - F列: 「推奨コード」印。
  # - G列: 更新区分。S(削除)の行は取り込まない。
  class LabSpecimenImporter
    SHEET_NAME = "材料コード"
    DELETED_KIND = "S"
    COLUMN_COUNT = 8

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
        rows.each do |attrs|
          record = Master::LabSpecimen.find_or_initialize_by(specimen_code: attrs[:specimen_code])
          record.assign_attributes(attrs)
          record.save!
        end
      end

      Result.new(imported_count: rows.size)
    end

    private

    attr_reader :file

    def parse_rows
      Tempfile.create(["lab_specimens", ".xlsx"], binmode: true) do |tmp|
        tmp.write(file.read)
        tmp.flush

        workbook = Roo::Excelx.new(tmp.path)
        unless workbook.sheets.include?(SHEET_NAME)
          raise ImportError, "「#{SHEET_NAME}」シートが見つかりません"
        end

        build_rows(workbook.sheet(SHEET_NAME), kana_by_text(tmp.path))
      end
    end

    def build_rows(sheet, kana_map)
      category = nil
      # 階層の親を辿るための [字下げ数, 材料コード] のスタック。
      ancestors = []
      display_order = 0

      (2..sheet.last_row).filter_map do |row_index|
        heading, _memo, code, raw_name, old_code, remark, update_kind =
          (1..COLUMN_COUNT).map { |col| sheet.cell(row_index, col).to_s.strip.presence }

        category = normalize_category(heading) if heading&.start_with?("◆")
        next if code.blank? || raw_name.blank?

        indent = raw_name[/\A　*/].length
        # 削除行も階層には積む(削除された親の下に現役の子が並ぶことがあるため)。
        ancestors.pop while ancestors.any? && ancestors.last.first >= indent
        parent_code = ancestors.last&.last
        ancestors.push([indent, code])

        next if update_kind == DELETED_KIND

        display_order += 10
        {
          specimen_code: code,
          name: raw_name.delete_prefix("　" * indent),
          category: category,
          parent_specimen_code: parent_code,
          recommended: remark.to_s.include?("推奨"),
          jlac10_specimen_code: old_code&.slice(/\d+/),
          name_kana: kana_map[raw_name].presence,
          display_order: display_order
        }
      end
    end

    # グループ見出し「◆消化管・付属消化器　(上部消化管)」→「消化管・付属消化器(上部消化管)」
    def normalize_category(heading)
      heading.delete_prefix("◆").gsub(/[[:space:]]+/, "").presence
    end

    # セルのルビ(読みがな)。Roo はルビを返さないため、sharedStrings.xml の
    # rPh 要素から「セルの文字列 → ルビ」の対応を直接作る。同じ文字列は
    # 同じ共有文字列に畳み込まれるので、文字列キーで一意に引ける。
    def kana_by_text(path)
      Zip::File.open(path) do |zip|
        entry = zip.find_entry("xl/sharedStrings.xml")
        break {} unless entry

        doc = Nokogiri::XML(entry.get_input_stream.read)
        doc.remove_namespaces!
        doc.xpath("/sst/si").each_with_object({}) do |si, map|
          text = si.xpath("./t | ./r/t").map(&:text).join.strip
          kana = si.xpath("./rPh/t").map(&:text).join
          map[text] = kana if text.present? && kana.present?
        end
      end
    end
  end
end
