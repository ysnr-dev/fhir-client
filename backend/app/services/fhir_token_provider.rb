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

  # The upstream runs on Render's free tier, which spins the service down after
  # ~15 min idle. The first request wakes it and can take ~50s (sometimes more)
  # to boot; until then the gateway either holds the request open or answers
  # 502/503/504. To avoid surfacing that as a token failure we (1) poll the
  # unauthenticated /up health check until the server is actually ready
  # (UpstreamWarmup, shared with FhirAdminGateway), then (2) POST the token with
  # a short retry as a safety net. Non-transient failures (e.g. 400
  # invalid_client) are never retried.
  TRANSIENT_STATUSES = [502, 503, 504].freeze
  # Seconds to wait between token attempts (~44s total), a safety net for the
  # brief window between /up going green and the token endpoint being ready.
  RETRY_BACKOFF = [2, 4, 8, 15, 15].freeze

  class TokenError < StandardError; end

  @default_mutex = Mutex.new

  class << self
    # Process-wide shared instance, so the token cache survives across
    # per-request FhirGateway instances. Rebuilt when the persisted connection
    # settings change (FhirConnectionSettings.config_version), so a base_url /
    # client_id change made via the admin UI propagates without a restart —
    # not just token expiry.
    def default
      @default_mutex.synchronize do
        version = FhirConnectionSettings.config_version
        if @default.nil? || @default_version != version
          cfg = FhirConnectionSettings.effective
          @default = new(
            base_url: cfg.base_url,
            client_id: cfg.client_id,
            client_secret: cfg.client_secret,
            token_path: cfg.token_path,
            host_header: cfg.host_header
          )
          @default_version = version
        end
        @default
      end
    end

    # Drop the shared instance so the next #default rebuilds from current
    # settings (called after the admin UI saves new settings).
    def reset_default!
      @default_mutex.synchronize do
        @default = nil
        @default_version = nil
      end
    end
  end

  def initialize(
    base_url: ENV.fetch("FHIR_SERVER_BASE_URL", "http://localhost:3000"),
    client_id: ENV["FHIR_SERVER_CLIENT_ID"].presence,
    client_secret: ENV["FHIR_SERVER_CLIENT_SECRET"].presence,
    token_path: "/oauth/token",
    host_header: ENV["FHIR_SERVER_HOST_HEADER"],
    clock: nil,
    sleeper: nil
  )
    @base_url = base_url.to_s.chomp("/")
    @token_url = "#{@base_url}#{token_path}"
    @client_id = client_id
    @client_secret = client_secret
    @host_header = host_header
    @clock = clock || -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }
    @sleeper = sleeper || ->(seconds) { sleep(seconds) }
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
    warm_up!
    response = post_token_with_retry

    payload = parse_json(response.body)
    token = payload["access_token"]
    raise TokenError, "token response did not contain access_token" if token.blank?

    expires_in = payload["expires_in"].to_i
    expires_in = DEFAULT_EXPIRES_IN unless expires_in.positive?
    @refresh_at = @clock.call + (expires_in * REFRESH_RATIO)
    @token = token
  end

  # Wake a spun-down upstream and wait until it is actually ready, so the token
  # POST below lands on a live server. Unconditional here: a token is fetched
  # roughly once an hour, so paying the probe is cheap. (FhirAdminGateway inverts
  # this -- it tries first and only warms up on a transient failure, because a
  # page load must not block for 90s.)
  def warm_up!
    UpstreamWarmup.wait_until_ready(base_url: @base_url, host_header: @host_header, sleeper: @sleeper)
  end

  # POSTs the client_credentials grant, retrying while the upstream is still
  # starting up (a fast 502/503/504 from the gateway, or a connection/read
  # timeout). Non-transient responses (e.g. 400 invalid_client) fail immediately.
  def post_token_with_retry
    attempt = 0
    loop do
      response =
        begin
          post_token
        rescue Faraday::TimeoutError, Faraday::ConnectionFailed => e
          raise TokenError, "token request failed: #{e.class}" if attempt >= RETRY_BACKOFF.size

          @sleeper.call(RETRY_BACKOFF[attempt])
          attempt += 1
          next
        end

      return response if response.success?

      # Deliberately omit the response body: it may echo request parameters.
      unless TRANSIENT_STATUSES.include?(response.status) && attempt < RETRY_BACKOFF.size
        raise TokenError, "token request failed with HTTP #{response.status}"
      end

      @sleeper.call(RETRY_BACKOFF[attempt])
      attempt += 1
    end
  end

  def post_token
    connection.post(
      nil,
      URI.encode_www_form(
        grant_type: "client_credentials",
        client_id: @client_id,
        client_secret: @client_secret
      ),
      { "Content-Type" => "application/x-www-form-urlencoded" }
    )
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
