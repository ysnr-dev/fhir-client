module Ssmix2
  # 上流 FHIR への書き込みを ssmix2_transactions に控える(docs/ssmix2-export-design.md §4)。
  # 中継(FhirProxyController)と backend 自身の書き込み(Integrations::FhirStore)から呼ばれる。
  # ここで失敗しても呼び出し元の応答は変えない(記録できなかったことだけをログに残す)。
  module Recorder
    module_function

    # method は :post / :put / :delete。path は "/" (transaction Bundle) か "/Patient/123" のような
    # リソースのパス。request_body / response_body は JSON の文字列か Hash。
    def record(method:, path:, status:, request_body:, response_body:, actor: nil)
      return unless Settings.enabled?
      return unless status.to_i.between?(200, 299)

      http_method = method.to_s.upcase
      return unless Ssmix2Transaction::METHODS.include?(http_method)

      request = parse(request_body)
      return unless Dispatcher.relevant?(http_method, path, request)

      Ssmix2Transaction.create!(
        occurred_at: Time.current,
        actor_practitioner_id: actor.presence,
        method: http_method,
        path: path.to_s,
        request: request || {},
        response: http_method == "DELETE" ? nil : parse(response_body)
      )
    rescue StandardError => e
      Rails.logger.error("[ssmix2] transaction の記録に失敗しました: #{e.class}: #{e.message}")
      nil
    end

    def parse(body)
      case body
      when nil then nil
      when Hash then body
      else
        text = body.to_s
        text.blank? ? nil : JSON.parse(text)
      end
    end
  end
end
