module Master
  # オーダー項目 → 結果項目の対応(1:N)。結果登録画面がオーダーの検査項目を
  # 結果の行に展開するときに引く。
  class LabOrderItemResult < ApplicationRecord
    self.table_name = "master_lab_order_item_results"

    # 外部キーは張らないが、結果項目を JSON に入れ子で出すために関連だけ持つ。
    belongs_to :result_item,
               class_name: "Master::LabResultItem",
               primary_key: :result_item_code,
               foreign_key: :result_item_code,
               optional: true

    validates :order_item_code, presence: true
    validates :result_item_code, presence: true, uniqueness: { scope: :order_item_code }

    # 結果項目(材料名付き)を入れ子にした JSON。結果登録画面の展開が 1 リクエストで済むように。
    # 結果項目がマスタから消えていれば result_item は null。
    def self.as_json_with_result_items(mappings)
      result_items = mappings.filter_map(&:result_item)
      by_code = Master::LabResultItem.as_json_with_specimen_names(result_items)
                                     .index_by { |json| json["result_item_code"] }
      mappings.map { |mapping| mapping.as_json.merge("result_item" => by_code[mapping.result_item_code]) }
    end
  end
end
