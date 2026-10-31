# 処方の明細(MedicationRequest.dosageInstruction[0])の 1 回量・1 日量。frontend の
# prescriptionHelpers.ts の prescriptionDoseOf と同じ読み方をする。
#
# 日数を持つ内服(内服で頓用でない)は、1 回量を doseAndRate.doseQuantity、1 日量を doseAndRate.rateRatio
# (JP Core の JP_MedicationRatio_DosePerDay)に持つ。rateRatio を持たない日数を持つ内服は、1 日量を
# doseQuantity に入れていた形として読み、1 回量は用法コード 4 桁目の回数で割って出す。
# 頓用は doseQuantity が 1 回量、外用などは doseQuantity が全量(amount)。
module PrescriptionDose
  USAGE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-usage".freeze
  USAGE_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-usage-basic-category".freeze
  SUPPLEMENTARY_USAGE_SYSTEM = "urn:oid:1.2.392.200250.2.2.20.22".freeze
  ORAL_CATEGORY_CODE = "1".freeze
  ORAL_CATEGORY_DISPLAY = "内服".freeze

  Amounts = Struct.new(:single, :daily, :amount, :unit, keyword_init: true) do
    # 量 1 つで扱うときの量(日数を持つ内服は 1 日量、頓用は 1 回量、外用などは全量)。
    def ordered
      daily || single || amount
    end

    # 「1回1錠（1日3錠）」。どちらかしか分からなければ「1日3錠」「1回1錠」、全量は「5g」。
    def text
      u = unit.to_s
      return "1回#{format(single)}#{u}（1日#{format(daily)}#{u}）" if single && daily
      return "1日#{format(daily)}#{u}" if daily
      return "1回#{format(single)}#{u}" if single

      amount.nil? ? "" : "#{format(amount)}#{u}"
    end

    private

    def format(value)
      value == value.to_i ? value.to_i.to_s : value.to_s
    end
  end

  module_function

  def of(dosage)
    dosage ||= {}
    dose_and_rate = dosage.dig("doseAndRate", 0) || {}
    quantity = dose_and_rate.dig("doseQuantity", "value")
    per_day = dose_and_rate.dig("rateRatio", "numerator", "value")
    unit = dose_and_rate.dig("doseQuantity", "unit") || dose_and_rate.dig("rateRatio", "numerator", "unit")
    return Amounts.new(single: quantity, daily: per_day, unit: unit) unless per_day.nil?
    return Amounts.new(unit: unit) if quantity.nil?

    usage_code = coding_code(dosage, USAGE_CODE_SYSTEM).to_s
    return Amounts.new(single: quantity, unit: unit) if as_needed?(usage_code)
    return Amounts.new(amount: quantity, unit: unit) unless oral?(dosage)

    times = times_per_day(usage_code)
    single = times && !uneven?(dosage) ? (quantity.to_r / times).round(3).to_f : nil
    Amounts.new(single: single, daily: quantity, unit: unit)
  end

  # 1 日の服用回数(用法コード 4 桁目。1〜9、A = 10 回 …)。Z(回数不定)などは nil。
  def times_per_day(usage_code)
    char = usage_code.to_s[3]
    char&.match?(/\A[1-9A-Y]\z/) ? char.to_i(36) : nil
  end

  def as_needed?(usage_code)
    usage_code.to_s[2] == "5"
  end

  def oral?(dosage)
    coding = Array(dosage.dig("timing", "code", "coding")).find { |c| c["system"] == USAGE_CATEGORY_SYSTEM }
    coding.present? && (coding["code"] == ORAL_CATEGORY_CODE || coding["display"] == ORAL_CATEGORY_DISPLAY)
  end

  # 不均等投与(補足用法 V)。各回の量が違うので 1 回量は 1 つに決まらない。
  def uneven?(dosage)
    Array(dosage["additionalInstruction"]).flat_map { |ai| Array(ai["coding"]) }
                                          .any? { |c| c["system"] == SUPPLEMENTARY_USAGE_SYSTEM && c["code"].to_s.start_with?("V") }
  end

  def coding_code(dosage, system)
    Array(dosage.dig("timing", "code", "coding")).find { |c| c["system"] == system }&.dig("code")
  end
end
