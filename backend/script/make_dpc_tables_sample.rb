# 実際の DPC 電子点数表から、いくつかの診断群分類(MDC6)の行だけを抜き出した
# テスト用の xlsx を作る(spec/fixtures/files/dpc_tables_sample.xlsx)。
#   docker compose exec backend ruby script/make_dpc_tables_sample.rb <電子点数表.xlsx> spec/fixtures/files/dpc_tables_sample.xlsx
require "roo"
require "zip"
require "cgi"

source, output = ARGV
KEEP = %w[060035 060330 040080 010060 060350 071030 050130].freeze

book = Roo::Excelx.new(source)

def text(value)
  case value
  when nil then ""
  when Float then value == value.to_i ? value.to_i.to_s : value.to_s
  else value.to_s
  end
end

def mdc6_of(sheet_name, row)
  case sheet_name
  when /\A11）/ then row[2].to_s[0, 6] # B 列始まり
  when /\A12）/ then row[1].to_s[0, 6]
  else
    mdc, cls = row[0], row[1]
    return nil unless mdc.to_s.match?(/\A\d{2}\z/)

    mdc + cls.to_s.rjust(4, "0")
  end
end

sheets = book.sheets.map do |name|
  sheet = book.sheet(name)
  rows = (1..sheet.last_row.to_i).map { |r| (1..sheet.last_column.to_i).map { |c| text(sheet.cell(r, c)) } }
  kept =
    case name
    when /前提|ダミー|\A１）|\A13\)/ then rows
    else
      rows.select do |row|
        mdc6 = mdc6_of(name, row)
        code_like = name =~ /\A1[12]）/ ? row.any? { |v| v.match?(/\A\d{5}[\dx][\dxA-Z]{8}\z/) } : !mdc6.nil?
        !code_like || KEEP.include?(mdc6) || (name =~ /ＩＣＤ/ && row[3] == "M!!!!")
      end
    end
  [name, kept]
end

def col_name(index)
  name = +""
  index += 1
  while index.positive?
    index, rem = (index - 1).divmod(26)
    name.prepend((65 + rem).chr)
  end
  name
end

def sheet_xml(rows)
  body = rows.each_with_index.map do |row, r|
    cells = row.each_with_index.filter_map do |value, c|
      next if value.empty?

      %(<c r="#{col_name(c)}#{r + 1}" t="inlineStr"><is><t xml:space="preserve">#{CGI.escapeHTML(value)}</t></is></c>)
    end
    %(<row r="#{r + 1}">#{cells.join}</row>)
  end
  %(<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>#{body.join}</sheetData></worksheet>)
end

File.delete(output) if File.exist?(output)
Zip::File.open(output, create: true) do |zip|
  overrides = sheets.each_index.map do |i|
    %(<Override PartName="/xl/worksheets/sheet#{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>)
  end
  zip.get_output_stream("[Content_Types].xml") do |f|
    f.write %(<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>#{overrides.join}</Types>)
  end
  zip.get_output_stream("_rels/.rels") do |f|
    f.write %(<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>)
  end
  entries = sheets.each_with_index.map do |(name, _), i|
    %(<sheet name="#{CGI.escapeHTML(name)}" sheetId="#{i + 1}" r:id="rId#{i + 1}"/>)
  end
  zip.get_output_stream("xl/workbook.xml") do |f|
    f.write %(<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>#{entries.join}</sheets></workbook>)
  end
  rels = sheets.each_index.map do |i|
    %(<Relationship Id="rId#{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet#{i + 1}.xml"/>)
  end
  zip.get_output_stream("xl/_rels/workbook.xml.rels") do |f|
    f.write %(<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">#{rels.join}</Relationships>)
  end
  sheets.each_with_index do |(_, rows), i|
    zip.get_output_stream("xl/worksheets/sheet#{i + 1}.xml") { |f| f.write sheet_xml(rows) }
  end
end
puts sheets.map { |name, rows| "#{name}: #{rows.size}" }
