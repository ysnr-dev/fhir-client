require "faraday"

module Integrations
  module Orca
    # 日レセ(WebORCA)API へのサーバー間クライアント。
    #
    # FhirGateway とは別クラスにしている。向き先も資格情報も別で、ボディは XML、
    # 「成功/失敗」も HTTP ステータスではなく本文の Api_Result で決まるため、
    # 中継用に作られた FhirGateway の作法がひとつも当てはまらない。
    class Gateway
      # 接続設定が入っていない。UI に「設定してください」と出すために区別する。
      class NotConfigured < StandardError; end
      # 接続はできたが日レセが XML を返さなかった(認証失敗の HTML など)。
      class InvalidResponse < StandardError; end

      Result = Struct.new(:api_result, :body, :request_xml, :response_body, keyword_init: true) do
        def ok? = api_result.ok?
        def status = api_result.status
      end

      # クラウド版は初回接続時に 503 +「マスター更新中です」を返す。オンプレ版でも
      # スキーマ移行中は応答しないので、待てば直るものだけ再送する。
      TRANSIENT_STATUSES = [502, 503, 504].freeze
      # 他端末使用中(Api_Result=90)と一時的な HTTP エラーの再送間隔。
      # 医事課が画面を触っている最中でも数秒で空くので、短く 3 回だけ。
      RETRY_BACKOFF = [0.5, 1.5, 3.0].freeze

      def initialize(config)
        @config = config
      end

      def configured? = config.usable?

      # path は "/api01rv2/system01lstv2" のように /api を含めずに渡す。
      # WebORCA 用の接頭辞は設定側(api_prefix)で足す。
      def post(path, root_name, attributes, params: {}, accepted_codes: [])
        raise NotConfigured unless configured?

        request_xml = Xml.build(root_name, attributes)
        response = send_with_retry(path, request_xml, params)

        unless response.status.between?(200, 299)
          raise InvalidResponse, "日レセが HTTP #{response.status} を返しました"
        end

        body = Xml.parse(response.body)
        raise InvalidResponse, "日レセの応答を XML として読めませんでした" if body.empty?

        Result.new(
          api_result: ApiResult.from(body, accepted_codes: accepted_codes),
          body: body,
          request_xml: request_xml,
          response_body: response.body.to_s
        )
      end

      # patientgetv2 だけは GET でクエリ文字列を取る(日レセ API で唯一)。
      def get(path, params)
        raise NotConfigured unless configured?

        response = connection.get(full_path(path)) { |req| req.params.update(params) }
        unless response.status.between?(200, 299)
          raise InvalidResponse, "日レセが HTTP #{response.status} を返しました"
        end

        body = Xml.parse(response.body)
        raise InvalidResponse, "日レセの応答を XML として読めませんでした" if body.empty?

        Result.new(
          api_result: ApiResult.from(body),
          body: body,
          request_xml: nil,
          response_body: response.body.to_s
        )
      end

      private

      attr_reader :config

      def send_with_retry(path, request_xml, params)
        attempt = 0
        loop do
          response = send_request(path, request_xml, params)
          return response unless retryable?(response)
          return response if attempt >= RETRY_BACKOFF.length

          sleep RETRY_BACKOFF[attempt]
          attempt += 1
        end
      end

      def retryable?(response)
        return true if TRANSIENT_STATUSES.include?(response.status)
        return false unless response.status.between?(200, 299)

        # 本文まで読まないと「他端末使用中」は判別できない。ここで 1 回 parse する
        # コストは、医事課と衝突したときに黙って失敗する不便より安い。
        body = begin
          Xml.parse(response.body)
        rescue StandardError
          {}
        end
        ApiResult.from(body).busy?
      end

      def send_request(path, request_xml, params)
        connection.post(full_path(path)) do |req|
          req.params.update(params) if params.present?
          req.headers["Content-Type"] = "application/xml; charset=UTF-8"
          req.headers["Accept"] = "application/xml"
          req.body = request_xml
        end
      end

      def full_path(path)
        prefix = config.option("api_prefix", "/api").to_s.chomp("/")
        "#{prefix}#{path}"
      end

      def connection
        @connection ||= Faraday.new(url: config.base_url) do |f|
          f.request :authorization, :basic, config.username, config.password
          f.options.open_timeout = 3
          # 診療行為の登録は中で点数計算まで走るので、FHIR 中継より長めに取る。
          f.options.timeout = 60
          f.adapter Faraday.default_adapter
        end
      end
    end
  end
end
