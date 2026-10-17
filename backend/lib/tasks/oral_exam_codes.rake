# 口腔診査情報標準コード仕様(JDAOES Ver.1.02、日本歯科医師会)のコード表を seed CSV にする。
# 配布ファイルは https://www.jda.or.jp/dentist/program/business-latest.html の
# 「マスター形式データ」と「OID 表」の xlsx 2 本。tmp/master-data/oral-exam/ に置いて実行する。
#
#   docker compose exec backend bin/rails "master_oral_exam_codes:csv[tmp/master-data/oral-exam/<master>.xlsx,tmp/master-data/oral-exam/<oid>.xlsx]"
#
# 歯ごとのレコード(TB/TD/TP/TM/TE/TF)・入力種別(NS)・口腔全体(KS/KK/SI/SK)のうち、
# コード値を持つ行だけを書き出す(文字列・数字・予備の項目は選択肢が無いので書かない)。
require "csv"

namespace :master_oral_exam_codes do
  desc "JDAOES のマスター形式データ・OID 表(xlsx)から db/seed_data/oral_exam_codes.csv を作る"
  task :csv, %i[master_xlsx oid_xlsx] => :environment do |_task, args|
    abort "usage: master_oral_exam_codes:csv[master.xlsx,oid.xlsx]" if args[:master_xlsx].blank? || args[:oid_xlsx].blank?

    records = Master::OralExamCode::RECORDS

    # 項目識別名称(TP-11)→ コーディングシステム名と OID。
    oid_sheet = Roo::Excelx.new(args[:oid_xlsx]).sheet(1)
    systems = {}
    (2..oid_sheet.last_row).each do |i|
      row = oid_sheet.row(i)
      item = row[4].to_s.delete("〔〕 　")
      next if item.blank? || row[5].blank?

      # 外部のコード表(MEDIS 標準歯式など)は「引用 OID」の列に入っている。
      systems[item] = { name: row[5].to_s.strip, oid: row[6].to_s.strip.presence || row[7].to_s.strip }
    end

    sheet = Roo::Excelx.new(args[:master_xlsx]).sheet(0)
    path = Rails.root.join("db/seed_data/oral_exam_codes.csv")
    written = 0
    CSV.open(path, "w") do |csv|
      csv << %w[record item item_name code display tf_ref cs_name cs_oid note display_order]
      (2..sheet.last_row).each do |i|
        serial, _chapter, _hk, item_name, item, code, display, note, *_rest = sheet.row(i)
        tf = sheet.row(i)[13]
        item = item.to_s.strip
        record = item.split("-").first
        code = code.to_s.strip
        next unless records.include?(record)
        # レコード識別情報(TB-1 など)と、コード表の無い項目(（文字列）・（数字）・（省略）)は外す。
        next if item.end_with?("-1") || code.empty? || code.start_with?("（")
        next if display.blank?

        system = systems[item] || {}
        csv << [
          record,
          item,
          item_name.to_s.sub(/\A（[０-９0-9]+）/, "").strip,
          code,
          display.to_s.strip,
          tf.to_s[/TF-\d+/],
          system[:name],
          system[:oid],
          note.to_s.gsub(/\s+/, " ").strip.presence,
          serial.to_i
        ]
        written += 1
      end
    end
    puts "#{path}: #{written} rows"
  end
end
