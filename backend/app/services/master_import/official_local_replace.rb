module MasterImport
  # JANIS 系など official/local 混在マスタの共通処理。source=official のみ
  # 全件洗い替えし、施設追加分(source=local)は温存する。frequent 列を持つ
  # マスタは、画面で選んだ頻用の印もコードをキーに引き継ぐ。
  module OfficialLocalReplace
    private

    def replace_official!(model, rows)
      raise ImportError, "取り込める行がありません" if rows.empty?

      ActiveRecord::Base.transaction do
        reject_local_conflicts(model, rows)
        preserve_frequent_flags(model, rows) if model.column_names.include?("frequent")

        model.official.delete_all
        rows.each_slice(1000) { |slice| model.insert_all!(slice) }
      end
    end

    def preserve_frequent_flags(model, rows)
      frequent_codes = model.frequent.pluck(:code).to_set
      rows.each { |row| row[:frequent] = frequent_codes.include?(row[:code]) }
    end

    # 施設追加コードと同じコードを配布ファイルが載せてきたら、どのコードが
    # 問題かを示して取込ごと止める(片側だけ入った状態を作らない)。
    def reject_local_conflicts(model, rows)
      local_codes = model.local.pluck(:code).to_set
      conflicts = rows.map { |row| row[:code] }.select { |code| local_codes.include?(code) }
      return if conflicts.empty?

      raise ImportError, "施設追加コードと重複しています: #{conflicts.join(', ')}"
    end
  end
end
