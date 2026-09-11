require "json"

# 統合通知(Task)を導入する前に溜まっていた承認待ちに、後から通知を作る一回限りの処理。
#
# 承認待ちは「代行入力(enterer ≠ author)で、まだ署名の無い来歴」という Provenance からの
# 導出値だった。導入後は登録・編集と同じ transaction で order-approval の Task を作るので、
# 導入前の承認待ちだけがヘッダーのベルと通知一覧に出てこない状態になる。
#
# 既に通知を持つ来歴は飛ばすので、何度流しても増えない。通知が作れなかった承認待ちも、
# オーダーの詳細モーダルからは従来どおり承認できる(通知が無くても承認は通る)。
#
#   docker compose exec backend bin/rails notifications:backfill_order_approval
#
# 対象と件数だけ見たいときは DRY_RUN=1 を付ける。
namespace :notifications do
  AGENT_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/provenance-participant-type".freeze
  TASK_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/task-code".freeze
  ORDER_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/order-type".freeze
  REGIMEN_ORDER_EXT_URL = "http://fhir-client.local/StructureDefinition/regimen-order".freeze

  # ServiceRequest.category の order-type コード → 通知一覧の種別。クライアントの
  # orderKindOf / approvalKindOf と同じ対応を持つ(あちらは種別ごとの判定関数に分かれているが、
  # 実体はこの 1 対 1 の対応)。ここに無いコードと category 無しは処方になる。
  ORDER_KINDS = {
    "nursing" => "nursing-order",
    "chemo-regimen" => "chemo-regimen",
    "lab" => "lab-order",
    "micro" => "micro-order",
    "pathology" => "patho-order",
    "rad" => "rad-order",
    "physio" => "physio-order",
    "endoscopy" => "endoscopy-order",
    "treatment" => "treatment-order",
    "surgery" => "surgery-order",
    "meal" => "meal-order",
    "transfusion" => "transfusion-order",
    "rehab" => "rehab-order",
    "nutrition-guidance" => "nutrition-guidance-order",
    "consult" => "consult-order",
    "injection" => "injection",
    "prescription" => "prescription"
  }.freeze
  ORDER_APPROVAL_CODE = "order-approval".freeze
  PAGE_SIZE = 100

  desc "導入前の承認待ち(署名の無い代行入力の来歴)に order-approval の通知を作る"
  task backfill_order_approval: :environment do
    dry_run = ENV["DRY_RUN"].present?
    gateway = FhirGateway.new

    pending = fetch_pending_provenances(gateway)
    puts "署名の無い来歴: #{pending[:provenances].size} 件"

    targets = pending[:provenances].select { |p| needs_approval?(p) }
    puts "うち代行入力(承認待ち): #{targets.size} 件"

    created = 0
    skipped = 0
    targets.each do |provenance|
      if approval_task_exists?(gateway, provenance["id"])
        skipped += 1
        next
      end

      task = build_approval_task(provenance, pending[:orders], pending[:patients])
      unless task
        puts "  skip: Provenance/#{provenance['id']} (対象オーダーか患者が引けない)"
        skipped += 1
        next
      end

      if dry_run
        puts "  would create: Provenance/#{provenance['id']} -> #{task['description']}"
        created += 1
        next
      end

      response = gateway.forward(
        method: :post,
        path: "/Task",
        body: JSON.generate(task),
        headers: { "Content-Type" => "application/fhir+json" }
      )
      if response.status.between?(200, 299)
        created += 1
      else
        puts "  error: Provenance/#{provenance['id']} -> #{response.status} #{response.body.to_s[0, 200]}"
      end
    end

    puts(dry_run ? "作成予定 #{created} 件 / 飛ばし #{skipped} 件" : "作成 #{created} 件 / 飛ばし #{skipped} 件")
  end

  # ---- 上流から引く ----

  # 署名の無い来歴を、対象オーダーと患者ごと引く。承認待ちは溜めない前提だが、
  # 導入前のぶんは溜まっている可能性があるので最後まで辿る。
  def fetch_pending_provenances(gateway)
    provenances = []
    orders = {}
    patients = {}
    offset = 0

    loop do
      query = [
        "signature-type:missing=true",
        "_include=Provenance:target",
        "_include:iterate=ServiceRequest:subject",
        "_sort=-recorded",
        "_count=#{PAGE_SIZE}",
        "_offset=#{offset}"
      ].join("&")
      bundle = get_json(gateway, "/Provenance", query)
      entries = bundle["entry"] || []
      break if entries.empty?

      page = 0
      entries.each do |entry|
        resource = entry["resource"]
        case resource && resource["resourceType"]
        when "Provenance" then (provenances << resource) && (page += 1)
        when "ServiceRequest" then orders[resource["id"]] = resource
        when "Patient" then patients[resource["id"]] = resource
        end
      end

      break if page.zero?

      offset += PAGE_SIZE
      break if offset >= bundle["total"].to_i
    end

    { provenances: provenances, orders: orders, patients: patients }
  end

  def approval_task_exists?(gateway, provenance_id)
    query = [
      "focus=Provenance/#{provenance_id}",
      "code=#{CGI.escape("#{TASK_CODE_SYSTEM}|#{ORDER_APPROVAL_CODE}")}",
      "_summary=count"
    ].join("&")
    get_json(gateway, "/Task", query)["total"].to_i.positive?
  end

  def get_json(gateway, path, query)
    response = gateway.forward(method: :get, path: path, query: query)
    raise "上流 #{path} が #{response.status}: #{response.body.to_s[0, 200]}" unless response.status == 200

    JSON.parse(response.body.to_s)
  end

  # ---- 判定と組み立て ----

  def agent_of_type(provenance, code)
    (provenance["agent"] || []).find do |agent|
      ((agent.dig("type", "coding")) || []).any? do |coding|
        coding["system"] == AGENT_TYPE_SYSTEM && coding["code"] == code
      end
    end
  end

  # 代行(入力者 ≠ 指示医師)で、まだ承認されていないもの。クライアントの needsApproval と同じ判定。
  def needs_approval?(provenance)
    enterer = agent_of_type(provenance, "enterer")&.dig("who", "reference")
    author = agent_of_type(provenance, "author")&.dig("who", "reference")
    verifier = agent_of_type(provenance, "verifier")
    enterer.present? && author.present? && enterer != author && verifier.nil?
  end

  # レジメンから出た注射・処方は「化学療法」に寄せる(クライアントの approvalKindOf と同じ)。
  def approval_kind_of(service_request)
    return "chemo-regimen" if (service_request["extension"] || []).any? { |e| e["url"] == REGIMEN_ORDER_EXT_URL }

    code = (service_request["category"] || []).filter_map { |c|
      (c["coding"] || []).find { |coding| coding["system"] == ORDER_TYPE_SYSTEM }&.dig("code")
    }.first
    ORDER_KINDS.fetch(code, "prescription")
  end

  # 通知の中身。一覧の内容セルとカルテへの詳細リンクは Task.input から読むので、
  # 新しく作るぶん(クライアント側)と同じキーで持たせる。
  def build_approval_task(provenance, orders, patients)
    order_ids = (provenance["target"] || []).filter_map do |target|
      target["reference"].to_s[%r{\AServiceRequest/(.+)\z}, 1]
    end
    targets = order_ids.filter_map { |id| orders[id] }
    first = targets.first
    return nil unless first

    owner = first["requester"]
    patient_id = first.dig("subject", "reference").to_s.split("/").last
    return nil if owner.nil? || owner["reference"].blank? || patient_id.blank?
    return nil unless patients.key?(patient_id)

    enterer = agent_of_type(provenance, "enterer")
    enterer_name = enterer&.dig("who", "display").presence || "代行入力"
    recorded = provenance["recorded"].presence || Time.zone.now.iso8601
    days = targets.filter_map { |sr| (sr["occurrenceDateTime"] || sr["authoredOn"]).to_s[0, 10].presence }.sort
    day_label = days.uniq.size <= 1 ? days.first : "#{days.first} 〜 #{days.last}"

    {
      "resourceType" => "Task",
      "status" => "requested",
      "intent" => "filler-order",
      "priority" => "routine",
      "code" => {
        "coding" => [{ "system" => TASK_CODE_SYSTEM, "code" => ORDER_APPROVAL_CODE, "display" => "オーダー承認" }],
        "text" => "オーダー承認"
      },
      "focus" => { "reference" => "Provenance/#{provenance['id']}" },
      "for" => { "reference" => "Patient/#{patient_id}" },
      "owner" => owner,
      "requester" => enterer["who"],
      "basedOn" => targets.map { |sr| { "reference" => "ServiceRequest/#{sr['id']}" } },
      "description" => "代行入力の承認（入力: #{enterer_name}）",
      "input" => [
        { "type" => { "text" => "活動" }, "valueCode" => activity_of(provenance) },
        *targets.map { |sr| approval_kind_of(sr) }.uniq.map do |kind|
          { "type" => { "text" => "種別" }, "valueCode" => kind }
        end,
        *targets.map do |sr|
          { "type" => { "text" => "対象オーダー" }, "valueReference" => { "reference" => "ServiceRequest/#{sr['id']}" } }
        end,
        *(day_label ? [{ "type" => { "text" => "開始日" }, "valueString" => day_label }] : [])
      ],
      "authoredOn" => recorded,
      "lastModified" => recorded
    }
  end

  def activity_of(provenance)
    code = (provenance.dig("activity", "coding") || []).first&.dig("code")
    %w[CREATE UPDATE CANCEL REACTIVATE COMPLETE SUSPEND RESUME].include?(code) ? code : "CREATE"
  end
end
