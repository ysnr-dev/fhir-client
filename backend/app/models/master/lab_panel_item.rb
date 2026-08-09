module Master
  # パネル(1オーダー → 複数結果)の構成。panel も member も検査オーダー項目なので、
  # パネルの中にパネルを入れ子にできる。
  class LabPanelItem < ApplicationRecord
    self.table_name = "master_lab_panel_items"

    # LOINC のパネル構成区分(R/O/C)と同じ考え方。
    MEMBER_TYPES = %w[required optional conditional].freeze

    validates :panel_item_code, presence: true
    validates :member_item_code, presence: true, uniqueness: { scope: :panel_item_code }
    validates :member_type, inclusion: { in: MEMBER_TYPES }
    validate :member_is_not_panel_itself

    private

    def member_is_not_panel_itself
      return if panel_item_code.blank? || member_item_code != panel_item_code

      errors.add(:member_item_code, "はパネル自身を指定できません")
    end
  end
end
