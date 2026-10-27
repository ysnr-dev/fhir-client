require "rails_helper"
require "support/billing_fhir_fixtures"

RSpec.describe "WaitingBoard::Public", type: :request do
  def body = JSON.parse(response.body)

  NUMBER_SYSTEM = WaitingBoard::RECEPTION_NUMBER_IDENTIFIER_SYSTEM
  CHECKED_IN_AT = WaitingBoard::Snapshot::CHECKED_IN_AT_URL

  let(:store) { BillingFhirFixtures::FakeStore.new }
  let!(:issued) { WaitingBoardLink.issue!(label: "1 階ロビー", location_ids: []) }
  let(:headers) { { "X-Board-Token" => issued[1] } }

  def appointment(id, number:, status: "checked-in", room: "room-1", department: "01", checked_in: "09:00", based_on: nil,
                  start: nil, walk_in: false)
    {
      "resourceType" => "Appointment", "id" => id, "status" => status,
      "start" => "2026-10-28T#{start || checked_in}:00+09:00",
      "appointmentType" => walk_in ? { "coding" => [{ "code" => "WALKIN" }] } : nil,
      "identifier" => number ? [{ "system" => NUMBER_SYSTEM, "value" => number }] : nil,
      "participant" => [
        { "actor" => { "reference" => "Patient/pat-#{id}", "display" => "患者 #{id}" } },
        room ? { "actor" => { "reference" => "Location/#{room}", "display" => "第 1 診察室" } } : nil
      ].compact,
      "specialty" => department ? [{ "coding" => [{ "system" => "urn:oid:1.2.392.100495.20.2.51", "code" => department, "display" => "内科" }] }] : nil,
      "extension" => [{ "url" => CHECKED_IN_AT, "valueDateTime" => "2026-10-28T#{checked_in}:00+09:00" }],
      "basedOn" => based_on
    }.compact
  end

  def encounter(id, appointment_id, status:, start:, room: nil)
    {
      "resourceType" => "Encounter", "id" => id, "status" => status,
      "appointment" => [{ "reference" => "Appointment/#{appointment_id}" }],
      "period" => { "start" => "2026-10-28T#{start}:00+09:00" },
      "location" => room ? [{ "location" => { "reference" => "Location/#{room}" } }] : nil
    }.compact
  end

  before do
    store.add(
      { "resourceType" => "Location", "id" => "room-2", "name" => "第 2 診察室",
        "extension" => [{ "url" => WaitingBoard::Snapshot::DISPLAY_ORDER_EXT_URL, "valueInteger" => 2 }] },
      { "resourceType" => "Location", "id" => "room-1", "name" => "第 1 診察室",
        "extension" => [{ "url" => WaitingBoard::Snapshot::DISPLAY_ORDER_EXT_URL, "valueInteger" => 1 }] },
      # 第 1 診察室: 1 番は診察中(受付 9:00 → 開始 9:10)、2・3 番は待ち、4 番は一時終了、5 番は診察済(受付 8:30 → 開始 8:50)。
      appointment("a1", number: "1"),
      encounter("e1", "a1", status: "in-progress", start: "09:10", room: "room-1"),
      appointment("a2", number: "2", start: "09:30"),
      appointment("a3", number: "3", start: "09:15"),
      appointment("a4", number: "4"),
      encounter("e4", "a4", status: "onleave", start: "09:05", room: "room-1"),
      appointment("a5", number: "5", status: "fulfilled", checked_in: "08:30"),
      encounter("e5", "a5", status: "finished", start: "08:50", room: "room-1"),
      # 取り消した診察開始は無かったことにする(6 番は待ちのまま)。
      appointment("a6", number: "6", walk_in: true, checked_in: "09:05"),
      encounter("e6", "a6", status: "entered-in-error", start: "09:20", room: "room-1"),
      # 呼出なしで始めた診察は「お呼び出し中」に出さない(待ちにも数えない)。
      appointment("a10", number: "10"),
      encounter("e10", "a10", status: "in-progress", start: "09:10", room: "room-1")
        .merge("extension" => [{ "url" => WaitingBoard::Snapshot::BOARD_CALL_URL, "valueBoolean" => false }]),
      # 診察室の無い受付は診療科で。
      appointment("a7", number: "7", room: nil),
      # 検査予約(オーダーにぶら下がる)は外来の受付ではない。
      appointment("a8", number: nil, based_on: [{ "reference" => "ServiceRequest/sr-1" }]),
      # 予約済(未受付)は表示板に載らない。
      appointment("a9", number: nil, status: "booked")
    )
    allow(Integrations::FhirStore).to receive(:new).and_return(store)
    allow(FacilityClock).to receive(:today).and_return(Date.new(2026, 10, 28))
    WaitingBoard::PublicController::RATE_LIMIT_STORE.clear
  end

  it "トークンが無い・違う・取り消し済みなら 401" do
    get "/waiting_board/public"
    expect(response).to have_http_status(:unauthorized)
    get "/waiting_board/public", headers: { "X-Board-Token" => "bogus" }
    expect(response).to have_http_status(:unauthorized)

    issued[0].revoke!
    get "/waiting_board/public", headers: headers
    expect(response).to have_http_status(:unauthorized)
  end

  it "診察室ごとに 呼出中・待ち・離席中・平均待ち時間 をまとめ、患者を特定できるものは返さない" do
    get "/waiting_board/public", headers: headers
    expect(response).to have_http_status(:ok)

    rooms = body["rooms"]
    expect(rooms.map { |r| r["name"] }).to eq(["第 1 診察室", "第 2 診察室"])
    first = rooms[0]
    expect(first["calling"]).to eq(["1"])
    expect(first["waiting"]).to eq(3)
    # 予約時間の順(当日受付は受付時刻から起こした start)。当日受付は予約時間を出さない。
    expect(first["waiting_list"]).to eq([
      { "number" => "6", "booked_time" => nil, "checked_in_time" => "09:05" },
      { "number" => "3", "booked_time" => "09:15", "checked_in_time" => "09:00" },
      { "number" => "2", "booked_time" => "09:30", "checked_in_time" => "09:00" }
    ])
    expect(first["away"]).to eq(1)
    # 受付→開始の実測(10・5・20・10 分)の平均。呼出なしの診察も待ち時間には入る。
    expect(first["average_wait_minutes"]).to eq(11)
    expect(rooms[1]).to include("calling" => [], "waiting" => 0, "waiting_list" => [], "away" => 0, "average_wait_minutes" => nil)

    expect(body["departments"]).to eq([
      { "code" => "01", "name" => "内科", "calling" => [], "waiting" => 1,
        "waiting_list" => [{ "number" => "7", "booked_time" => "09:00", "checked_in_time" => "09:00" }],
        "away" => 0, "average_wait_minutes" => nil }
    ])

    expect(response.body).not_to include("pat-")
    expect(response.body).not_to include("患者")
    expect(store.searches.map(&:first)).not_to include("Patient")
    expect(store.searches.flat_map { |_, p| p.values }.join).not_to include("Appointment:patient")
  end

  it "診察室を絞ったリンクはその診察室だけを出し、診療科の区画は出さない" do
    _link, token = WaitingBoardLink.issue!(label: "第 2 診察室前", location_ids: ["room-2"])
    get "/waiting_board/public", headers: { "X-Board-Token" => token }

    expect(body["rooms"].map { |r| r["id"] }).to eq(["room-2"])
    expect(body["departments"]).to eq([])
  end
end
