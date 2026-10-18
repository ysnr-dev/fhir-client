# 検証用の模擬 CDS サービス(docs/cds-hooks-design.md §5.1)。依存は rack だけ。
#
#   docker compose exec -d backend bundle exec rackup -p 8787 script/cds_demo_service.ru
#
# backend からは http://localhost:8787 で届くので、管理画面「CDS サービス」にそのまま登録する。
# patient-view に 3 枚のカード(情報 / warning + SMART リンク / critical + 無視理由)、
# order-select に選んだ薬剤の数の情報カード、order-sign に重要(critical)のカードを 1 枚返す。
# feedback は受けた内容を標準出力に出す。
require "json"
require "securerandom"

DEMO_SMART_APP_URL = ENV.fetch("CDS_DEMO_SMART_APP_URL", "http://localhost:5173/smart-demo/index.html")

DISCOVERY = {
  "services" => [
    {
      "hook" => "patient-view",
      "id" => "demo-patient-view",
      "title" => "デモ: 患者を開いたときの判断支援",
      "description" => "prefetch の患者と処方からカードを返す模擬サービス",
      "prefetch" => {
        "patient" => "Patient/{{context.patientId}}",
        "meds" => "MedicationRequest?patient={{context.patientId}}&status=active"
      }
    },
    {
      "hook" => "order-select",
      "id" => "demo-order-select",
      "title" => "デモ: 薬剤を選んだときの判断支援",
      "description" => "selections の薬剤名を返す模擬サービス"
    },
    {
      "hook" => "order-sign",
      "id" => "demo-order-sign",
      "title" => "デモ: 処方の登録前の判断支援",
      "description" => "draftOrders の件数と、重要のカードを返す模擬サービス",
      "prefetch" => { "patient" => "Patient/{{context.patientId}}" }
    }
  ]
}.freeze

def draft_names(request, ids = nil)
  entries = Array(request.dig("context", "draftOrders", "entry"))
  entries = entries.select { |e| ids.include?("MedicationRequest/#{e.dig('resource', 'id')}") } if ids
  entries.map { |e| e.dig("resource", "medicationCodeableConcept", "text") || "(名称なし)" }
end

def order_select_cards(request)
  names = draft_names(request, Array(request.dig("context", "selections")))
  [{
    "uuid" => SecureRandom.uuid,
    "summary" => "選んだ薬剤: #{names.join('、')}",
    "detail" => "order-select の selections に含まれる MedicationRequest の名称です。",
    "indicator" => "info",
    "source" => { "label" => "CDS デモ", "topic" => { "display" => "order-select" } }
  }]
end

def order_sign_cards(request)
  names = draft_names(request)
  [{
    "uuid" => SecureRandom.uuid,
    "summary" => "登録前の確認: #{names.size} 剤(#{names.first(3).join('、')})",
    "detail" => "order-sign の draftOrders を受け取りました。重要のカードは無視の理由を選ぶまで登録できません。",
    "indicator" => "critical",
    "source" => { "label" => "CDS デモ", "topic" => { "display" => "order-sign" } },
    "overrideReasons" => [
      { "code" => "benefit-outweighs-risk", "system" => "http://example.org/cds-demo/override", "display" => "利益が上回る" },
      { "code" => "already-reviewed", "system" => "http://example.org/cds-demo/override", "display" => "確認済み" }
    ]
  }]
end

def patient_name(patient)
  name = Array(patient&.dig("name")).first
  return "(氏名不明)" unless name

  name["text"] || [name["family"], *Array(name["given"])].compact.join(" ")
end

def cards_for(request)
  context = request["context"] || {}
  prefetch = request["prefetch"] || {}
  patient = prefetch["patient"]
  meds = Array(prefetch.dig("meds", "entry")).size
  [
    {
      "uuid" => SecureRandom.uuid,
      "summary" => "#{patient_name(patient)} を開きました(有効な処方 #{meds} 件、受診 #{context['encounterId'] ? 'あり' : 'なし'})",
      "detail" => "prefetch で受け取った Patient と MedicationRequest の件数です。\nこのカードは情報のみで、無視理由は求めません。",
      "indicator" => "info",
      "source" => { "label" => "CDS デモ", "url" => "https://cds-hooks.hl7.org/" },
      "links" => [{ "label" => "CDS Hooks の仕様", "url" => "https://cds-hooks.hl7.org/2.0/", "type" => "absolute" }]
    },
    {
      "uuid" => SecureRandom.uuid,
      "summary" => "腎機能に応じた用量の確認を推奨します",
      "detail" => "直近の eGFR と処方中の腎排泄薬を突き合わせてください。アプリで開くと appContext にカードの id が渡ります。",
      "indicator" => "warning",
      "source" => { "label" => "CDS デモ", "topic" => { "display" => "薬剤安全" } },
      "links" => [
        {
          "label" => "用量確認アプリで開く",
          "url" => DEMO_SMART_APP_URL,
          "type" => "smart",
          "appContext" => { "card" => "renal-dose", "patientId" => context["patientId"] }.to_json
        }
      ],
      "overrideReasons" => [
        { "code" => "already-reviewed", "system" => "http://example.org/cds-demo/override", "display" => "確認済み" },
        { "code" => "not-applicable", "system" => "http://example.org/cds-demo/override", "display" => "該当しない" }
      ]
    },
    {
      "uuid" => SecureRandom.uuid,
      "summary" => "アレルギー歴と処方の照合を推奨します",
      "indicator" => "critical",
      "source" => { "label" => "CDS デモ" },
      "suggestions" => [
        {
          "label" => "薬剤アレルギーの確認を記録する",
          "actions" => [{ "type" => "create", "description" => "AllergyIntolerance(確認済み)を 1 件作成" }]
        }
      ]
    }
  ]
end

app = lambda do |env|
  request = Rack::Request.new(env)
  json = ->(status, body) { [status, { "content-type" => "application/json" }, [body.to_json]] }

  case [request.request_method, request.path]
  when ["GET", "/cds-services"]
    json.call(200, DISCOVERY)
  when ["POST", "/cds-services/demo-patient-view"]
    body = JSON.parse(request.body.read)
    $stdout.puts("[cds-demo] #{body['hook']} patient=#{body.dig('context', 'patientId')} prefetch=#{(body['prefetch'] || {}).keys.join(',')}")
    json.call(200, { "cards" => cards_for(body) })
  when ["POST", "/cds-services/demo-order-select"]
    body = JSON.parse(request.body.read)
    $stdout.puts("[cds-demo] order-select selections=#{body.dig('context', 'selections').inspect}")
    json.call(200, { "cards" => order_select_cards(body) })
  when ["POST", "/cds-services/demo-order-sign"]
    body = JSON.parse(request.body.read)
    $stdout.puts("[cds-demo] order-sign drafts=#{Array(body.dig('context', 'draftOrders', 'entry')).size}")
    json.call(200, { "cards" => order_sign_cards(body) })
  when ["POST", "/cds-services/demo-patient-view/feedback"], ["POST", "/cds-services/demo-order-select/feedback"],
       ["POST", "/cds-services/demo-order-sign/feedback"]
    $stdout.puts("[cds-demo] feedback #{request.path} #{request.body.read}")
    json.call(200, {})
  else
    json.call(404, { "error" => "not found" })
  end
end

run app
