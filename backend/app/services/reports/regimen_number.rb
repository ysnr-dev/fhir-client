module Reports
  # 化学療法の帳票の数値の書式。末尾の 0 は落とす(「85.0」→「85」、「1.50」→「1.5」)。
  module RegimenNumber
    module_function

    def format(value)
      return "" if value.nil? || value.to_s.strip.empty?

      BigDecimal(value.to_s).round(2).to_s("F").sub(/\.?0+\z/, "")
    rescue ArgumentError
      value.to_s
    end
  end
end
