module Master
  # セット(1オーダー → 複数の撮影)の構成。set も member も放射線オーダー項目。
  # 検体検査のパネル構成(master_lab_panel_items)と同じ考え方。
  class RadSetItem < ApplicationRecord
    self.table_name = "master_rad_set_items"

    validates :set_item_code, presence: true
    validates :member_item_code, presence: true, uniqueness: { scope: :set_item_code }
    validate :member_is_not_set_itself

    private

    def member_is_not_set_itself
      return if set_item_code.blank? || member_item_code != set_item_code

      errors.add(:member_item_code, "はセット自身を指定できません")
    end
  end
end
