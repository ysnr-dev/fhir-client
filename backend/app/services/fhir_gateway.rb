require "faraday"

class FhirGateway
  # Rails apps enable ActionDispatch::HostAuthorization by default, which only
  # allows a small set of hostnames (localhost, 127.0.0.1, ...) in development.
  # When the FHIR server is reached via a Docker-internal hostname (e.g.
  # host.docker.internal) that upstream would reject as an unrecognized Host
  # header, FHIR_SERVER_HOST_HEADER lets us present an allowed Host header
  # while still connecting to the real target.
  # base_url / host_header default from the effective connection settings
  # (persisted admin settings, falling back to ENV). UNSET lets callers pass an
  # explicit nil host_header (meaning "send no Host header") without it being
  # overridden by the effective value — and keeps unit specs that inject both
  # from ever touching the DB.
  UNSET = Object.new

  # 上流への接続はプロセスで共有する。リクエストごとに Faraday::Connection を作ると
  # 毎回 TCP + TLS のハンドシェイクが走り、Render 間の往復ではそれが 1 リクエストの
  # 大半を占める。net_http_persistent アダプタは接続をスレッドごとに持つので、
  # Puma の複数スレッドから同じ Connection を使っても安全。接続先(base_url)と
  # Host ヘッダの組ごとに 1 つ。
  @connections = {}
  @connections_mutex = Mutex.new

  class << self
    def connection_for(base_url, host_header)
      key = [base_url, host_header]
      @connections_mutex.synchronize do
        @connections[key] ||= build_connection(base_url, host_header)
      end
    end

    # 共有接続を捨てる(spec が接続を差し替えた後の後片付け用)。
    def reset_connections!
      @connections_mutex.synchronize { @connections.clear }
    end

    private

    def build_connection(base_url, host_header)
      Faraday.new(url: base_url) do |f|
        f.options.open_timeout = 2
        f.options.timeout = 15
        # FHIR は同じ検索パラメータの繰り返しを AND として使う(生年月日の範囲指定
        # birthdate=ge...&birthdate=le... や、_include の複数指定など)。Faraday 既定の
        # NestedParamsEncoder は繰り返しキーを最後の1つに潰してしまうため、
        # 繰り返しをそのまま保持する FlatParamsEncoder を使う。
        f.options.params_encoder = Faraday::FlatParamsEncoder
        f.headers["Host"] = host_header if host_header.present?
        f.adapter :net_http_persistent
      end
    end
  end

  def initialize(
    base_url: UNSET,
    host_header: UNSET,
    token_provider: FhirTokenProvider.default
  )
    if base_url.equal?(UNSET) || host_header.equal?(UNSET)
      config = FhirConnectionSettings.effective
      base_url = config.base_url if base_url.equal?(UNSET)
      host_header = config.host_header if host_header.equal?(UNSET)
    end

    @token_provider = token_provider
    @connection = self.class.connection_for(base_url, host_header)
  end

  def forward(method:, path:, query: nil, body: nil, headers: {})
    response = send_request(method, path, query, body, headers)
    # The cached token may have been revoked upstream: refresh it once.
    if response.status == 401 && token_provider.enabled?
      token_provider.invalidate!
      response = send_request(method, path, query, body, headers)
    end
    response
  end

  private

  attr_reader :connection, :token_provider

  def send_request(method, path, query, body, headers)
    request_headers = headers.dup
    token = token_provider.access_token
    request_headers["Authorization"] = "Bearer #{token}" if token
    connection.run_request(method, build_path(path, query), body, request_headers)
  end

  def build_path(path, query)
    query.present? ? "#{path}?#{query}" : path
  end
end
