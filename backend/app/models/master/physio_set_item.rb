module Master
  # セット(1オーダー → 複数の検査)の構成。set も member も生理検査オーダー項目。
  # 放射線のセット構成(master_rad_set_items)と同じ考え方。
  class PhysioSetItem < ApplicationRecord
    self.table_name = "master_physio_set_items"

    validates :set_item_code, presence: true
    validates :member_item_code, presence: true, uniqueness: { scope: :set_item_code }
    validate :member_is_not_set_itself
    validate :member_is_not_solo

    private

    def member_is_not_set_itself
      return if set_item_code.blank? || member_item_code != set_item_code

      errors.add(:member_item_code, "はセット自身を指定できません")
    end

    # 単独オーダーの項目は、セットに入れると他の検査と同じオーダーに載ってしまう。
    # FK が無いのでコードで引いて確かめる(逆向きの防止は PhysioItem 側にある)。
    #
    # 画面にそのまま出る文なので、属性名が頭に付かない :base に載せる。
    def member_is_not_solo
      return if member_item_code.blank?

      member = PhysioItem.find_by(item_code: member_item_code)
      return if member.nil? || member.groupable

      errors.add(:base, "「#{member.name}」は単独オーダーの項目のためセットに追加できません")
    end
  end
end
