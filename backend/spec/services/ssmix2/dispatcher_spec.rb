require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Dispatcher do
  F = Ssmix2::Fhir unless defined?(F)

  def bundle(entries, locations)
    request = { "resourceType" => "Bundle", "type" => "transaction", "entry" => entries }
    response = { "resourceType" => "Bundle", "type" => "transaction-response",
                 "entry" => locations.map { |l| { "response" => { "status" => "201", "location" => l } } } }
    ssmix2_transaction(method: "POST", path: "/", request: request, response: response)
  end

  it "resolves urn:uuid references to the assigned ids and plans the administration builders for a perform record" do
    hub = { "resourceType" => "Procedure", "status" => "completed", "category" => { "coding" => [{ "system" => F::ORDER_TYPE_SYSTEM, "code" => "injection" }] },
            "basedOn" => [{ "reference" => "ServiceRequest/sr1" }] }
    ma = { "resourceType" => "MedicationAdministration", "status" => "completed", "partOf" => [{ "reference" => "urn:uuid:hub" }] }
    transaction = bundle([{ "fullUrl" => "urn:uuid:hub", "resource" => hub, "request" => { "method" => "POST", "url" => "Procedure" } },
                          { "fullUrl" => "urn:uuid:ma", "resource" => ma, "request" => { "method" => "POST", "url" => "MedicationAdministration" } }],
                         %w[Procedure/proc9/_history/1 MedicationAdministration/ma9/_history/1])

    written = described_class.written_resources(transaction)
    expect(written.map(&:type)).to eq(%w[Procedure MedicationAdministration])
    expect(written[1].resource["partOf"]).to eq([{ "reference" => "Procedure/proc9" }])

    builders = described_class.plan(transaction).map(&:builder)
    expect(builders).to include(Ssmix2::Messages::RasO17, Ssmix2::Messages::OmiZ23)
    expect(builders.count(Ssmix2::Messages::RasO17)).to eq(1)
  end

  it "re-plans the hub when only a medication administration is written, and the order builders for a service request" do
    ma = { "resourceType" => "MedicationAdministration", "id" => "ma1", "status" => "completed", "partOf" => [{ "reference" => "Procedure/proc1" }] }
    transaction = ssmix2_transaction(method: "PUT", path: "/MedicationAdministration/ma1", request: ma, response: ma)
    plans = described_class.plan(transaction)
    expect(plans.map { |p| [p.builder, p.written.type, p.written.id] }).to eq([[Ssmix2::Messages::RasO17, "Procedure", "proc1"]])

    sr = { "resourceType" => "ServiceRequest", "id" => "sr1", "status" => "active" }
    plans = described_class.plan(ssmix2_transaction(method: "PUT", path: "/ServiceRequest/sr1", request: sr, response: sr))
    expect(plans.map(&:builder)).to eq([Ssmix2::Messages::RdeO11, Ssmix2::Messages::OmlO33, Ssmix2::Messages::OmdO03, Ssmix2::Messages::OmgO19])

    encounter = { "resourceType" => "Encounter", "id" => "e1", "status" => "planned" }
    plans = described_class.plan(ssmix2_transaction(method: "POST", path: "/Encounter", request: encounter, response: encounter))
    expect(plans.map(&:builder)).to eq([Ssmix2::Messages::EncounterAdt, Ssmix2::Messages::EncounterPlanAdt, Ssmix2::Messages::EncounterAttendingAdt])
  end

  it "re-plans the hub when only a child procedure is written" do
    child = { "resourceType" => "Procedure", "id" => "child1", "status" => "completed", "partOf" => [{ "reference" => "Procedure/hub1" }] }
    plans = described_class.plan(ssmix2_transaction(method: "PUT", path: "/Procedure/child1", request: child, response: child))
    expect(plans.map { |p| [p.builder, p.written.id] }).to eq([[Ssmix2::Messages::RasO17, "child1"], [Ssmix2::Messages::OmiZ23, "child1"],
                                                                 [Ssmix2::Messages::RasO17, "hub1"], [Ssmix2::Messages::OmiZ23, "hub1"]])
  end

  it "treats Procedure and MedicationAdministration writes as relevant" do
    expect(described_class.relevant?("POST", "/Procedure", { "resourceType" => "Procedure" })).to be(true)
    expect(described_class.relevant?("DELETE", "/MedicationAdministration/1", nil)).to be(true)
    expect(described_class.relevant?("POST", "/Observation", { "resourceType" => "Observation" })).to be(false)
  end
end
