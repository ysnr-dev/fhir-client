require "faraday"

# SMART Backend Services (OAuth2 client_credentials) token provider for the
# upstream FHIR server.
#
# When FHIR_SERVER_CLIENT_ID / FHIR_SERVER_CLIENT_SECRET are not configured,
# runs in no-auth mode and #access_token returns nil (no Authorization header
# should be sent) — preserving the previous pass-through behaviour.
#
# The token is cached process-wide (see .default) and refreshed proactively
# once 90% of its lifetime has elapsed. Concurrent callers are serialized by a
# Mutex, so only one thread fetches while the others wait and reuse the result.
class FhirTokenProvider
  DEFAULT_EXPIRES_IN = 3600
  # Refresh proactively once this fraction of the token lifetime has elapsed.
  REFRESH_RATIO = 0.9

  class TokenError < StandardError; end

  @default_mutex = Mutex.new

  class << self
    # Process-wide shared instance, so the token cache survives across
    # per-request FhirGateway instances.
    def default
      @default_mutex.synchronize { @default ||= new }
    end

    # For tests: drop the shared instance so changed ENV is picked up.
    def reset_default!
      @default_mutex.synchronize { @default = nil }
    end
  end

  def initialize(
    base_url: ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000"),
    client_id: ENV["FHIR_SERVER_CLIENT_ID"].presence,
    client_secret: ENV["FHIR_SERVER_CLIENT_SECRET"].presence,
    host_header: ENV["FHIR_SERVER_HOST_HEADER"],
    clock: nil
  )
    @token_url = "#{base_url.to_s.chomp('/')}/oauth/token"
    @client_id = client_id
    @client_secret = client_secret
    @host_header = host_header
    @clock = clock || -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }
    @mutex = Mutex.new
    @token = nil
    @refresh_at = 0.0
  end

  def enabled?
    @client_id.present? && @client_secret.present?
  end

  # Returns a cached or freshly fetched access token, or nil in no-auth mode.
  def access_token
    return nil unless enabled?

    @mutex.synchronize do
      return @token if @token && @clock.call < @refresh_at

      fetch_token
    end
  end

  # Drop the cached token so the next #access_token fetches a fresh one
  # (e.g. after the upstream returned 401).
  def invalidate!
    @mutex.synchronize do
      @token = nil
      @refresh_at = 0.0
    end
  end

  private

  def fetch_token
    response = connection.post(
      nil,
      URI.encode_www_form(
        grant_type: "client_credentials",
        client_id: @client_id,
        client_secret: @client_secret
      ),
      { "Content-Type" => "application/x-www-form-urlencoded" }
    )

    unless response.success?
      # Deliberately omit the response body: it may echo request parameters.
      raise TokenError, "token request failed with HTTP #{response.status}"
    end

    payload = parse_json(response.body)
    token = payload["access_token"]
    raise TokenError, "token response did not contain access_token" if token.blank?

    expires_in = payload["expires_in"].to_i
    expires_in = DEFAULT_EXPIRES_IN unless expires_in.positive?
    @refresh_at = @clock.call + (expires_in * REFRESH_RATIO)
    @token = token
  end

  def connection
    @connection ||= Faraday.new(url: @token_url) do |f|
      f.options.open_timeout = 2
      f.options.timeout = 15
      f.headers["Host"] = @host_header if @host_header.present?
      f.headers["Accept"] = "application/json"
      f.adapter Faraday.default_adapter
    end
  end

  def parse_json(body)
    JSON.parse(body.to_s)
  rescue JSON::ParserError
    {}
  end
end
