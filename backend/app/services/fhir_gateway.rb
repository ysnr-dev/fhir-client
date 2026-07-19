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
    host_header: ENV["FHIR_SERVER_HOST_HEADER"]
  )
    @connection = Faraday.new(url: base_url) do |f|
      f.options.open_timeout = 2
      f.options.timeout = 15
      f.headers["Host"] = host_header if host_header.present?
      f.adapter Faraday.default_adapter
    end
  end

  def forward(method:, path:, query: nil, body: nil, headers: {})
    connection.run_request(method, build_path(path, query), body, headers)
  end

  private

  attr_reader :connection

  def build_path(path, query)
    query.present? ? "#{path}?#{query}" : path
  end
end
