require "rails_helper"

RSpec.describe "レセコンからの通知", type: :request do
  let(:token) { "bridge-token" }
  let(:handler) { instance_double(Integrations::ReceiptComputer::EventHandler) }

  before do
    ExternalSystemConnection.reset_cache!
    ExternalSystemConnection.current(ExternalSystemConnection::RECEIPT_COMPUTER)
                            .update!(system_type: "orca", enabled: true,
                                     base_url: "http://orca.example:8000",
                                     username: "ormaster", password: "secret",
                                     inbound_token: token)
    allow(Integrations::ReceiptComputer::EventHandler).to receive(:new).and_return(handler)
  end

  after { ExternalSystemConnection.reset_cache! }

  def post_event(payload, bearer: token)
    headers = { "CONTENT_TYPE" => "application/json" }
    headers["Authorization"] = "Bearer #{bearer}" if bearer
    post "/integrations/receipt/events", params: payload.to_json, headers: headers
  end

  def patient_event(event_id: "u-1")
    { event_id: event_id, type: "patient.changed", patient_number: "00002" }
  end

  # ブラウザからは呼ばれないので、ログインセッションではなく発行済みトークンで認証する。
  it "rejects a request without the token" do
    post_event(patient_event, bearer: nil)

    expect(response).to have_http_status(:unauthorized)
  end

  it "rejects a request with the wrong token" do
    post_event(patient_event, bearer: "wrong")

    expect(response).to have_http_status(:unauthorized)
  end

  it "accepts a 患者 notification and hands it to the handler" do
    expect(handler).to receive(:call).with(hash_including("type" => "patient.changed",
                                                          "patient_number" => "00002"))

    post_event(patient_event)

    expect(response).to have_http_status(:accepted)
  end

  it "passes the 受付 details through" do
    expect(handler).to receive(:call) do |payload|
      expect(payload["reception"]).to include("key" => "2026-09-20:00003",
                                              "department_code" => "01")
    end

    post_event({ event_id: "u-2", type: "reception.created", patient_number: "00002",
                 reception: { key: "2026-09-20:00003", date: "2026-09-20", time: "10:16:00",
                              department_code: "01", physician_code: "10001",
                              coverage_set_key: "0001" } })

    expect(response).to have_http_status(:accepted)
  end

  it "refuses an unknown event type" do
    allow(handler).to receive(:call).and_raise(ArgumentError, "type が不正です")

    post_event({ event_id: "u-3", type: "invoice.created", patient_number: "00002" })

    expect(response).to have_http_status(:bad_request)
  end

  # 通知は再配達されないので、落とさずブリッジに送り直させる。
  it "asks the bridge to retry when the レセコン or 上流 is unreachable" do
    allow(handler).to receive(:call).and_raise(Integrations::ReceiptComputer::Unreachable, "timeout")

    post_event(patient_event)

    expect(response).to have_http_status(:service_unavailable)
  end

  it "is closed while no token has been issued" do
    ExternalSystemConnection.current(ExternalSystemConnection::RECEIPT_COMPUTER)
                            .update!(inbound_token: nil)
    ExternalSystemConnection.reset_cache!

    post_event(patient_event)

    expect(response).to have_http_status(:not_found)
  end
end
