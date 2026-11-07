require "json"

# 進捗 Task だけで中止していたオーダーの status を、Task に揃える一回限りの処理。
#
# 中止は部門の進捗 Task を cancelled にする操作で、オーダー(ServiceRequest)の status は
# active のまま残っていた。医事会計と SS-MIX2 は Task を読まず status で中止を判定するので、
# 中止したオーダーが会計に載り、SS-MIX2 の取消も出なかった。いまは中止と同じ transaction で
# status も revoked にする(frontend/src/fhir/taskHelpers.ts の orderCancelEntries)ので、
# 導入前に中止したぶんだけをここで揃える。処方・注射は薬剤行(MedicationRequest)も cancelled にする。
#
# 既に revoked のオーダーは飛ばすので、何度流しても変わらない。
#
#   docker compose exec backend bin/rails orders:backfill_cancelled_status
#
# 対象と件数だけ見たいときは DRY_RUN=1 を付ける。
namespace :orders do
  ORDERS_TASK_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/task-code".freeze
  # 中止を Task だけで表していた部門の作業種別。
  ORDERS_CANCELLABLE_TASK_CODES = %w[
    lab-exam micro-exam patho-exam rad-exam physio-exam endoscopy-exam treatment surgery transfusion
    rehab nutrition-guidance medication-guidance rx-dispense injection
  ].freeze
  # 薬剤行も揃える種別(処方・注射)。
  ORDERS_MEDICATION_TASK_CODES = %w[rx-dispense injection].freeze
  ORDERS_PAGE_SIZE = 100

  desc "進捗 Task が中止のオーダーの status を revoked に揃える"
  task backfill_cancelled_status: :environment do
    dry_run = ENV["DRY_RUN"].present?
    gateway = FhirGateway.new

    updated = 0
    skipped = 0
    ORDERS_CANCELLABLE_TASK_CODES.each do |code|
      orders = orders_fetch_cancelled_orders(gateway, code)
      next if orders.empty?

      puts "#{code}: 中止 Task が指すオーダー #{orders.size} 件"
      orders.each do |order|
        unless order["status"] == "active"
          skipped += 1
          next
        end

        lines = ORDERS_MEDICATION_TASK_CODES.include?(code) ? orders_fetch_medication_lines(gateway, order["id"]) : []
        if dry_run
          puts "  would revoke: ServiceRequest/#{order['id']} (薬剤行 #{lines.size} 件)"
          updated += 1
          next
        end

        response = gateway.forward(
          method: :post,
          path: "/",
          body: JSON.generate(orders_cancel_bundle(order, lines)),
          headers: { "Content-Type" => "application/fhir+json" }
        )
        if response.status.between?(200, 299)
          updated += 1
        else
          puts "  error: ServiceRequest/#{order['id']} -> #{response.status} #{response.body.to_s[0, 200]}"
        end
      end
    end

    puts(dry_run ? "更新予定 #{updated} 件 / 飛ばし #{skipped} 件" : "更新 #{updated} 件 / 飛ばし #{skipped} 件")
  end

  # 中止の Task が focus で指すオーダー。_include で同じ応答に載せる。
  def orders_fetch_cancelled_orders(gateway, code)
    orders = {}
    offset = 0
    loop do
      query = [
        "code=#{CGI.escape("#{ORDERS_TASK_CODE_SYSTEM}|#{code}")}",
        "status=cancelled",
        "_include=Task:focus",
        "_count=#{ORDERS_PAGE_SIZE}",
        "_offset=#{offset}"
      ].join("&")
      bundle = orders_get_json(gateway, "/Task", query)
      entries = bundle["entry"] || []
      break if entries.empty?

      tasks = 0
      entries.each do |entry|
        resource = entry["resource"]
        case resource["resourceType"]
        when "Task" then tasks += 1
        when "ServiceRequest" then orders[resource["id"]] = resource
        end
      end
      break if tasks < ORDERS_PAGE_SIZE

      offset += ORDERS_PAGE_SIZE
    end
    orders.values
  end

  def orders_fetch_medication_lines(gateway, order_id)
    bundle = orders_get_json(gateway, "/MedicationRequest", "based-on=ServiceRequest/#{order_id}&_count=200")
    (bundle["entry"] || []).map { |e| e["resource"] }.select { |mr| mr["status"] == "active" }
  end

  # 中止と同じ形(frontend の rxOrderCancelEntries / orderCancelEntries)。読んだ版を ifMatch に添える。
  def orders_cancel_bundle(order, lines)
    entries = [orders_put_entry(order.merge("status" => "revoked"))]
    entries += lines.map { |line| orders_put_entry(line.merge("status" => "cancelled")) }
    { "resourceType" => "Bundle", "type" => "transaction", "entry" => entries }
  end

  def orders_put_entry(resource)
    request = { "method" => "PUT", "url" => "#{resource['resourceType']}/#{resource['id']}" }
    version = resource.dig("meta", "versionId")
    request["ifMatch"] = "W/\"#{version}\"" if version
    { "resource" => resource, "request" => request }
  end

  def orders_get_json(gateway, path, query)
    response = gateway.forward(method: :get, path: path, query: query)
    raise "上流 #{path} が #{response.status}: #{response.body.to_s[0, 200]}" unless response.status == 200

    JSON.parse(response.body.to_s)
  end
end
