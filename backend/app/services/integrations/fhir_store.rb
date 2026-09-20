module Integrations
  # 上流 FHIR サーバーの読み書き。連携は backend 側でリソースを組み立てるので、
  # ブラウザを経由せずここから出入りする。
  #
  # FhirGateway は中継用で Faraday::Response をそのまま返すので、JSON 化・
  # Bundle の平坦化・条件付き更新だけを足した薄い層にしている。
  class FhirStore
    class NotFound < StandardError; end
    class UpstreamError < StandardError; end
    # 条件に複数当たって更新先を決められない。人手で直すしかないので区別する。
    class AmbiguousMatch < StandardError; end

    JSON_TYPE = "application/fhir+json".freeze
    # 上流は既定では知らない検索条件を黙って無視する。連携は取り込み・取消の判断を
    # 検索結果に委ねているので、条件が効かなかったときは全件が返るより失敗してほしい。
    STRICT_HANDLING = { "Prefer" => "handling=strict" }.freeze

    def initialize(gateway: FhirGateway.new)
      @gateway = gateway
    end

    def read(resource_type, id)
      response = gateway.forward(method: :get, path: "/#{resource_type}/#{id}")
      raise NotFound, "#{resource_type}/#{id} が見つかりません" if response.status == 404

      parse!(response)
    end

    # 見つからなければ nil。存在確認のたびに例外を組み立てないための入口。
    def read_or_nil(resource_type, id)
      read(resource_type, id)
    rescue NotFound
      nil
    end

    # 検索して entry の resource だけを配列で返す。link[next] を追う。
    def search(resource_type, params, limit: 500)
      collected = []
      query = encode(params)
      path = "/#{resource_type}"

      while collected.length < limit
        bundle = parse!(gateway.forward(method: :get, path: path, query: query,
                                        headers: STRICT_HANDLING))
        collected.concat(Array(bundle["entry"]).filter_map { |entry| entry["resource"] })

        nxt = Array(bundle["link"]).find { |l| l["relation"] == "next" }&.dig("url")
        break if nxt.blank?

        uri = URI.parse(nxt)
        path = uri.path.sub(%r{\A.*(?=/#{resource_type})}, "")
        query = uri.query
      end

      collected.first(limit)
    end

    # identifier などの検索条件で作成/更新する(FHIR の conditional update)。
    # 0 件なら作成、1 件なら更新、複数件なら上流が 412 を返す。
    def conditional_put(resource_type, resource, criteria)
      response = gateway.forward(
        method: :put,
        path: "/#{resource_type}",
        query: encode(criteria),
        body: resource.to_json,
        headers: { "Content-Type" => JSON_TYPE }
      )
      raise AmbiguousMatch, "#{resource_type} の更新先が一意に決まりません" if response.status == 412

      parse!(response)
    end

    def put(resource_type, id, resource)
      parse!(gateway.forward(
        method: :put,
        path: "/#{resource_type}/#{id}",
        body: resource.to_json,
        headers: { "Content-Type" => JSON_TYPE }
      ))
    end

    private

    attr_reader :gateway

    def parse!(response)
      unless response.status.between?(200, 299)
        raise UpstreamError, "上流が HTTP #{response.status} を返しました: #{response.body.to_s.first(300)}"
      end

      body = response.body.to_s
      return {} if body.blank?

      JSON.parse(body)
    end

    def encode(params)
      params.compact.map { |k, v| "#{k}=#{CGI.escape(v.to_s)}" }.join("&")
    end
  end
end
