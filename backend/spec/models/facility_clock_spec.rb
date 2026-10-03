require "rails_helper"

RSpec.describe FacilityClock do
  # 日本時間 10/04 08:00 は UTC では 10/03 23:00。Date.current は前日を返す。
  around { |example| travel_to(Time.utc(2026, 10, 3, 23, 0, 0)) { example.run } }

  it "日本時間の今日を返す" do
    expect(Date.current).to eq(Date.new(2026, 10, 3))
    expect(described_class.today).to eq(Date.new(2026, 10, 4))
    expect(described_class.now.hour).to eq(8)
  end

  describe "Master::ValidityPeriod" do
    it "日本時間の今日から有効な項目を、朝 9 時前でも返す" do
      Master::MealItem.create!(item_code: "NEW", name: "今日から", valid_from: Date.new(2026, 10, 4))
      Master::MealItem.create!(item_code: "OLD", name: "昨日まで", valid_to: Date.new(2026, 10, 3))

      expect(Master::MealItem.active_on.pluck(:item_code)).to eq(%w[NEW])
    end
  end
end
