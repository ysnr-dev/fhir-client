class RenameExtractStratumColumn < ActiveRecord::Migration[8.0]
  # データ抽出の記録タブの結果の列「群」を「比較群」と呼ぶ。内訳の切り口は列の見出しで持つので、
  # 保存した条件の行・列・区切りが「群」を指していれば「比較群」に読み替える。
  OLD = "群".freeze
  NEW = "比較群".freeze

  class Query < ActiveRecord::Base
    self.table_name = "extract_queries"
  end

  def up
    Query.where.not(tab: "patient").find_each do |query|
      breakdown = query.definition.is_a?(Hash) ? query.definition["breakdown"] : nil
      next unless breakdown.is_a?(Hash)

      changed = false
      %w[rows columns].each do |key|
        next unless breakdown[key] == OLD

        breakdown[key] = NEW
        changed = true
      end
      if breakdown["bins"].is_a?(Hash) && breakdown["bins"].key?(OLD)
        breakdown["bins"][NEW] = breakdown["bins"].delete(OLD)
        changed = true
      end
      query.update_columns(definition: query.definition) if changed
    end
  end

  def down
    # 呼び名だけの変更なので戻さない。
  end
end
