# 外部公開用のレジメン(docs/chemo-regimen-design.md §8.29)。レジメンマスタ 1 件を
# 患者情報なしで刷る。中身は backend DB から読み、上流からは自院の Organization だけを読む
# (医療機関名と問い合わせ先の電話番号)。
#
# 公開してよいのは承認済のレジメンだけ(下書きは審査前、廃止は運用していない)。
# 副作用は無い(読むだけ)。
class RegimenMasterReport
  include Reports::UpstreamBundle

  class NotFound < StandardError; end
  class NotApproved < StandardError; end
  class UpstreamError < StandardError; end

  # 同梱レイアウト(docs/report-mappings/regimen-01.md)。マスタ(report_layouts)には登録しない。
  LAYOUT_PATH = Rails.root.join("lib/report_layouts/regimen_public.tlf").freeze

  def initialize(regimen_id, gateway: FhirGateway.new)
    @regimen_id = regimen_id
    @gateway = gateway
  end

  def generate
    regimen = Master::Regimen.find_by(id: @regimen_id)
    raise NotFound, "regimen #{@regimen_id} not found" unless regimen
    raise NotApproved, "regimen #{regimen.regimen_code} is not approved" unless regimen.status == "approved"

    steps = regimen.steps.to_a
    Reports::RegimenPublicRenderer.new(
      layout_path: LAYOUT_PATH, regimen:, steps:,
      drugs_by_step: Master::RegimenDrug.with_names.where(step_id: steps.map(&:id)).in_display_order
                                        .group_by(&:step_id),
      usages: Master::MedicineUsage.where(usage_code: steps.filter_map(&:usage_code)).index_by(&:usage_code),
      organization: fetch_institution, printed_on: FacilityClock.today
    ).render
  end

  private

  attr_reader :gateway

  def fetch_institution
    self_organization_id = FacilitySettings.self_organization_id
    bundle = { "resourceType" => "Bundle", "type" => "batch",
               "entry" => [{ "request" => { "method" => "GET", "url" => institution_url(self_organization_id) } }] }
    upstream = gateway.forward(
      method: :post, path: "/", body: bundle.to_json,
      headers: { "Content-Type" => "application/fhir+json" }
    )
    ensure_success!(upstream, "batch bundle")
    find_institution(Array(JSON.parse(upstream.body)["entry"])[0], self_organization_id)
  end
end
