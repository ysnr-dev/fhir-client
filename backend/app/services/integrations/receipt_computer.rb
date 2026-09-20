module Integrations
  # レセコン連携の入口。どの製品と繋ぐかはここで解決し、呼び側は
  # ReceiptComputer.adapter が返すポートだけを使う。
  module ReceiptComputer
    # 失敗の語彙は外部システム連携で共通。
    Error = Integrations::Error
    NotConfigured = Integrations::NotConfigured
    Unreachable = Integrations::Unreachable
    Rejected = Integrations::Rejected
    NotFound = Integrations::NotFound

    SYSTEM_KEY = ExternalSystemConnection::RECEIPT_COMPUTER

    # カルテ側で発行する識別子の名前空間。連携先の製品名は入れない。
    NAMESPACE = "http://fhir-client.local/integrations/receipt-computer".freeze
    COVERAGE_IDENTIFIER_SYSTEM = "#{NAMESPACE}/coverage".freeze
    COVERAGE_CLASS_SYSTEM = "#{NAMESPACE}/coverage-class".freeze
    COVERAGE_TYPE_SYSTEM = "#{NAMESPACE}/coverage-type".freeze
    RECEPTION_IDENTIFIER_SYSTEM = "#{NAMESPACE}/reception".freeze
    RECEPTION_COVERAGE_SET_URL = "#{NAMESPACE}/StructureDefinition/reception-coverage-set".freeze
    # 請求セット(保険組合せ)を表す class エントリのコード。
    BILLING_SET_CODE = "billing-set".freeze

    module_function

    def connection = ExternalSystemConnection.effective(SYSTEM_KEY)

    def enabled? = connection.enabled

    def usable? = connection.usable?

    def definition = ExternalSystems.find!(SYSTEM_KEY)

    def adapter(config = connection)
      klass = definition.adapter_class(config.system_type)
      raise NotConfigured, "対応していない医事会計システムです: #{config.system_type}" if klass.nil?

      klass.new(config)
    end

    # 接続が使えるかまで確かめてからアダプタを返す。
    def adapter!
      config = connection
      raise NotConfigured, "医事会計システムの接続設定が未入力です" unless config.usable?

      adapter(config)
    end

    def log = EventLog.for(SYSTEM_KEY)

    def store = FhirStore.new
  end
end
