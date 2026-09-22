require "rails_helper"

RSpec.describe Integrations::ReceiptComputer::DiagnosisCollector do
  let(:date) { "2026-09-20" }
  let(:store) do
    Class.new do
      attr_accessor :conditions

      def initialize = @conditions = []
      def search(_type, _params, **) = conditions
    end.new
  end

  subject(:collector) { described_class.new(store: store) }

  def condition(code: "4609008", text: "感冒", category: "encounter-diagnosis",
                onset: "2026-09-01", abatement: nil, prefixes: [], postfixes: [], status: "active")
    extensions =
      prefixes.map { |c| modifier_extension(Integrations::ReceiptComputer::Coding::PREFIX_MODIFIER_EXT, c) } +
      postfixes.map { |c| modifier_extension(Integrations::ReceiptComputer::Coding::POSTFIX_MODIFIER_EXT, c) }

    resource = {
      "resourceType" => "Condition",
      "id" => "c-#{code}",
      "category" => [{ "coding" => [{ "code" => category }] }],
      "clinicalStatus" => { "coding" => [{ "code" => status }] },
      "code" => {
        "text" => text,
        "coding" => code ? [{ "system" => Integrations::ReceiptComputer::Coding::DISEASE_RECEIPT, "code" => code }] : [],
        "extension" => extensions.presence
      }.compact
    }
    resource["onsetDateTime"] = onset if onset
    resource["abatementDateTime"] = abatement if abatement
    resource
  end

  def modifier_extension(url, code)
    {
      "url" => url,
      "valueCodeableConcept" => {
        "coding" => [{ "system" => Integrations::ReceiptComputer::Coding::MODIFIER_RECEIPT, "code" => code }]
      }
    }
  end

  def collect = collector.call(patient_fhir_id: "p1", perform_date: date)

  # 修飾語の接頭辞や転帰の記号は連携先ごとの話なので、電文に直したうえで確かめる。
  def orca_children(key = nil)
    Integrations::Orca::DiseaseMessage.build(collect, key).first
  end

  it "composes 接頭語 → 病名 → 接尾語 with the ZZZ prefix the 日レセ uses for 修飾語" do
    store.conditions = [condition(prefixes: %w[2056], postfixes: %w[8002])]

    expect(collect.first.codes).to eq(%w[4609008])
    expect(collect.first.modifier_codes).to eq(prefix: %w[2056], postfix: %w[8002])
    expect(collect.first.suspected).to be(true)
    expect(orca_children.first["Disease_Single"].map { |d| d["Disease_Single_Code"] })
      .to eq(%w[ZZZ2056 4609008 ZZZ8002])
  end

  it "maps 転帰 to the 日レセ codes and leaves 継続 blank" do
    store.conditions = [
      condition(code: "1", status: "resolved"),
      condition(code: "2", status: "inactive"),
      condition(code: "3", status: "active")
    ]

    expect(collect.map(&:outcome)).to eq([:resolved, :inactive, nil])
    expect(orca_children.map { |c| c["Disease_OutCome"] }).to eq(%w[F N] + [nil])
  end

  it "keeps 保険病名 and drops プロブレム and 既往歴" do
    store.conditions = [
      condition(code: "1", text: "保険病名"),
      condition(code: "2", text: "プロブレム", category: "problem-list-item"),
      condition(code: "3", text: "既往歴", category: "past-history")
    ]

    expect(collect.map(&:name)).to eq(["保険病名"])
  end

  # category を持たない古いデータはカルテ側でも保険病名として扱う。
  it "treats a condition without a category as 保険病名" do
    store.conditions = [condition.except("category")]

    expect(collect.length).to eq(1)
  end

  it "drops diseases that had not started or were already closed on the day" do
    store.conditions = [
      condition(code: "1", text: "未来", onset: "2026-09-21"),
      condition(code: "2", text: "終了済", onset: "2026-08-01", abatement: "2026-09-19"),
      condition(code: "3", text: "当日終了", onset: "2026-08-01", abatement: date)
    ]

    expect(collect.map(&:name)).to eq(%w[当日終了])
  end

  # フリー入力の病名はレセプトに使えるコードを持たない。落とすのは仕方ないが黙って消さない。
  it "marks free-text diseases as having no code" do
    store.conditions = [condition(code: nil, text: "手書き病名")]

    expect(collect.first.codes).to be_empty
  end

  # コードの無い病名だけなら電文は空になる。空配列を送ると日レセがエラーを返すので、
  # アダプタはここで送信そのものを取りやめる。
  it "produces no 電文 when nothing can be sent, and says why" do
    store.conditions = [condition(code: nil, text: "手書き病名")]

    children, skipped = Integrations::Orca::DiseaseMessage.build(collect, nil)

    expect(children).to be_empty
    expect(skipped.first[:name]).to eq("手書き病名")
  end
end
