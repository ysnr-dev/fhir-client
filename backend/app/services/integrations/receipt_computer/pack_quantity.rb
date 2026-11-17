module Integrations
  module ReceiptComputer
    # 薬剤の量 → レセコンに送る数量(薬価算定単位)。処方・注射のオーダーは量を力価(mg など)・
    # 容量(mL)・包装単位(枚・本など)で持つことがあるので、投与量換算マスタにその単位の行があれば
    # 薬価算定単位の数量に直す。行が無い単位は薬価算定単位とみなしてそのまま送る。
    module PackQuantity
      module_function

      # dose は FHIR の Quantity(value / unit)。[数量の文字列, 単位] を返す。
      def of(medicine_code, dose)
        value = dose&.dig("value")
        unit = dose&.dig("unit")
        return [nil, unit] if value.nil?

        conversion = Master::MedicineDoseConversion.for_unit(medicine_code, unit)
        return [Numbers.format(value), unit] unless conversion && conversion.to_unit != unit

        [Numbers.format((value.to_d / conversion.factor).round(3)), conversion.to_unit]
      end
    end
  end
end
