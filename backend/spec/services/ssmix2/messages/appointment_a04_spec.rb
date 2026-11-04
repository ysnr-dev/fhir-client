require "rails_helper"
require "support/ssmix2_helpers"

RSpec.describe Ssmix2::Messages::AppointmentA04 do
  let(:store) { ssmix2_store({ "Patient/p1" => ssmix2_patient, "Practitioner/doc1" => ssmix2_doctor }) }
  let(:context) { Ssmix2::Context.new(store: store, cache: Ssmix2::ResourceCache.new) }
  let(:appointment) do
    { "resourceType" => "Appointment", "id" => "ap1", "status" => "checked-in", "start" => "2026-11-04T09:00:00+09:00",
      "extension" => [{ "url" => Ssmix2::Fhir::APPOINTMENT_CHECKED_IN_AT_EXT_URL, "valueDateTime" => "2026-11-04T08:52:00+09:00" }],
      "specialty" => [{ "coding" => [{ "system" => Ssmix2::Fhir::DEPARTMENT_CODE_SYSTEM, "code" => "01", "display" => "内科" }] }],
      "participant" => [{ "actor" => { "reference" => "Patient/p1" } }, { "actor" => { "reference" => "Practitioner/doc1" } }] }
  end

  before { ssmix2_enable! }

  def build(resource, method:, version: nil, previous: nil)
    allow(store).to receive(:read_or_nil).with("Appointment/ap1/_history", version - 1).and_return(previous) if version && version > 1
    transaction = ssmix2_transaction(method: method, path: "/Appointment/ap1", request: resource, response: resource)
    written = Ssmix2::Dispatcher::Written.new(method: method, type: "Appointment", id: "ap1", version: version, resource: resource)
    described_class.new(context: context, transaction: transaction, written: written).build
  end

  it "sends ADT^A04 with the department and the time of reception" do
    result = build(appointment, method: "POST", version: 1)

    expect(result.data_kind).to eq("ADT-12")
    expect(result.service_date).to eq("20261104")
    expect(result.department_code).to eq("01")
    expect(segment(result, "MSH")).to include("|ADT^A04^ADT_A01|")
    pv1 = segment(result, "PV1").split("|")
    expect(pv1[2]).to eq("O")
    expect(pv1[3]).to eq("01^^^^^C")
    expect(pv1[7]).to eq("220^医師^一郎^^^^^^^L^^^^^I")
    expect(pv1[44]).to eq("20261104085200")
  end

  it "does not repeat the reception when a checked-in appointment is edited, and ignores other statuses" do
    expect(build(appointment, method: "PUT", version: 2, previous: appointment)).to be_nil
    expect(build(appointment.merge("status" => "booked"), method: "POST", version: 1)).to be_nil
    expect(build(appointment, method: "PUT", version: 2, previous: appointment.merge("status" => "booked"))).not_to be_nil
  end
end
