module Integrations
  module ReceiptComputer
    # 数量の文字列化。1.0 を "1" に、0.5 を "0.5" にする(電文は文字列で、"1.0" は冗長)。
    module Numbers
      module_function

      def format(value)
        float = value.to_f
        float == float.to_i ? float.to_i.to_s : float.to_s
      end
    end
  end
end
