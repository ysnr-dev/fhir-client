require "rails_helper"

RSpec.describe PrescriptionDose do
  def dosage(usage_code:, category: "内服", quantity: nil, per_day: nil, unit: "錠", uneven: false)
    dose_and_rate = {}
    dose_and_rate["doseQuantity"] = { "value" => quantity, "unit" => unit } if quantity
    if per_day
      dose_and_rate["rateRatio"] = {
        "numerator" => { "value" => per_day, "unit" => unit },
        "denominator" => { "value" => 1, "unit" => "日", "system" => "http://unitsofmeasure.org", "code" => "d" }
      }
    end
    result = {
      "timing" => {
        "code" => {
          "coding" => [
            { "system" => described_class::USAGE_CODE_SYSTEM, "code" => usage_code },
            { "system" => described_class::USAGE_CATEGORY_SYSTEM, "display" => category }
          ]
        }
      },
      "doseAndRate" => [dose_and_rate]
    }
    if uneven
      result["additionalInstruction"] = [
        { "coding" => [{ "system" => described_class::SUPPLEMENTARY_USAGE_SYSTEM, "code" => "V1Z2" }] }
      ]
    end
    result
  end

  # 1日3回朝昼夕食後
  let(:tid) { "1013044400000000" }

  it "reads the per-dose quantity and the per-day ratio" do
    amounts = described_class.of(dosage(usage_code: tid, quantity: 1, per_day: 3))

    expect([amounts.single, amounts.daily, amounts.ordered]).to eq([1, 3, 3])
    expect(amounts.text).to eq("1回1錠（1日3錠）")
  end

  it "reads an oral dose without rateRatio as the daily dose" do
    amounts = described_class.of(dosage(usage_code: tid, quantity: 1, unit: "g"))

    expect(amounts.daily).to eq(1)
    expect(amounts.single).to eq(0.333)
    expect(amounts.text).to eq("1回0.333g（1日1g）")
  end

  it "does not derive the per-dose quantity of an uneven dose" do
    amounts = described_class.of(dosage(usage_code: tid, per_day: 4, uneven: true))

    expect(amounts.text).to eq("1日4錠")
  end

  it "reads as-needed and topical doses as they are" do
    expect(described_class.of(dosage(usage_code: "1050110020000000", quantity: 1)).text).to eq("1回1錠")
    expect(described_class.of(dosage(usage_code: "2B74000000000000", category: "外用", quantity: 5, unit: "g")).text)
      .to eq("5g")
  end

  it "reads the times per day from the fourth character of the usage code" do
    expect(described_class.times_per_day(tid)).to eq(3)
    expect(described_class.times_per_day("104AB70000000000")).to eq(10)
    expect(described_class.times_per_day("137Z000000000000")).to be_nil
  end
end
