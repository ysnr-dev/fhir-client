require "faraday"

class FhirGateway
  # Rails apps enable ActionDispatch::HostAuthorization by default, which only
  # allows a small set of hostnames (localhost, 127.0.0.1, ...) in development.
  # When the FHIR server is reached via a Docker-internal hostname (e.g.
  # host.docker.internal) that upstream would reject as an unrecognized Host
  # header, FHIR_SERVER_HOST_HEADER lets us present an allowed Host header
  # while still connecting to the real target.
  def initialize(
    base_url: ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000"),
    host_header: ENV["FHIR_SERVER_HOST_HEADER"],
    token_provider: FhirTokenProvider.default
  )
    @token_provider = token_provider
    @connection = Faraday.new(url: base_url) do |f|
      f.options.open_timeout = 2
      f.options.timeout = 15
      f.headers["Host"] = host_header if host_header.present?
      f.adapter Faraday.default_adapter
    end
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
