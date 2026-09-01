module Reports
  # オーダー(ServiceRequest)の日付の読み方。全オーダー種で共通の規約:
  #   - occurrenceDateTime: オーダー開始日/実施予定日(日付だけ "YYYY-MM-DD"、
  #                         またはオフセット付き dateTime)。帳票に刷る臨床上の日付。
  #   - authoredOn:         オーダー登録日時(オフセット付きのシステムタイムスタンプ)。
  #                         いつ登録したかであって、いつ実施するかではない。
  # occurrenceDateTime を持たない移行前のオーダーは authoredOn の日付で代用する
  # (当時は登録日 = 実施日として運用していたため)。
  module OrderDates
    module_function

    # オーダー開始日/実施日("YYYY-MM-DD")。無ければ "" 。
    def order_day(order)
      (order["occurrenceDateTime"].presence || order["authoredOn"]).to_s.first(10)
    end
  end
end
