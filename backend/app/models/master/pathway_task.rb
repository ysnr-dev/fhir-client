module Master
  # タスク。order_type があればオーダーの雛形(オーダーセットのエントリと同じ形)、
  # 無ければチェックリスト項目。task_key は適用後まで持ち越す識別子。
  class PathwayTask < ApplicationRecord
    self.table_name = "master_pathway_tasks"

    # ePath のタスク分類(大)。TP 治療 / EX 検査 / ML 食事 / NO 観察項目 / NC ケア項目 /
    # EG 教育・指導・説明 / AL 活動・安静度 / MD 医療文書
    CATEGORIES_LV1 = %w[TP EX ML NO NC EG AL MD].freeze
    # ePath のタスク分類(中)。先頭 2 文字が大分類。
    CATEGORIES_LV2 = (
      %w[TPPR TPIN TPRE TPTR TPOP TPBT TPRH TPDI TPRT TPCI
         EXSP EXMB EXPH EXEN EXIM EXPA
         MLBR MLLU MLSU
         EGNC EGCS EGIC EGEP] + (1..17).map { |n| format("NC%02d", n) }
    ).freeze

    validates :pathway_code, :unit_id, presence: true
    validates :task_key, presence: true, format: { with: PathwayOatUnit::UUID_FORMAT }
    validates :name, presence: true
    validates :category_lv1, inclusion: { in: CATEGORIES_LV1 }
    validates :category_lv2, inclusion: { in: CATEGORIES_LV2 }, allow_blank: true
    validates :order_type, inclusion: { in: OrderSetEntry::ORDER_TYPES }, allow_blank: true
    validates :order_schema_version, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
    validate :lv2_belongs_to_lv1
    validate :order_values_must_be_object

    scope :in_display_order, -> { order(Arel.sql("display_order NULLS LAST")).order(:id) }

    def order_template?
      order_type.present?
    end

    private

    def lv2_belongs_to_lv1
      return if category_lv2.blank? || category_lv2.start_with?(category_lv1.to_s)

      errors.add(:category_lv2, "は大分類 #{category_lv1} に属する分類を指定してください")
    end

    def order_values_must_be_object
      errors.add(:order_values, "はオブジェクトで指定してください") unless order_values.is_a?(Hash)
    end
  end
end
