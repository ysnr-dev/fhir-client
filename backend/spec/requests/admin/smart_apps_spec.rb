require "rails_helper"

RSpec.describe "Admin::SmartApps", type: :request do
  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  let(:payload) { { name: "計算ツール", client_id: SecureRandom.uuid, launch_url: "https://app.example/launch" } }

  it "lists apps in position order" do
    SmartApp.create!(payload.merge(name: "B", position: 2))
    SmartApp.create!(payload.merge(name: "A", client_id: SecureRandom.uuid, position: 1))

    with_admin_token(nil) { get "/admin/smart_apps" }

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["items"].map { |i| i["name"] }).to eq(%w[A B])
  end

  it "creates an app at the end and updates it" do
    SmartApp.create!(payload.merge(position: 3))

    with_admin_token(nil) do
      post "/admin/smart_apps", params: payload.merge(client_id: SecureRandom.uuid, display: "window"), as: :json
    end
    expect(response).to have_http_status(:created)
    expect(response.parsed_body).to include("position" => 4, "display" => "window", "enabled" => true)

    id = response.parsed_body["id"]
    with_admin_token(nil) { patch "/admin/smart_apps/#{id}", params: { enabled: false }, as: :json }
    expect(response).to have_http_status(:ok)
    expect(SmartApp.find(id).enabled).to be(false)
  end

  it "returns 422 with the validation messages" do
    with_admin_token(nil) { post "/admin/smart_apps", params: payload.merge(launch_url: "/launch"), as: :json }

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to be_present
  end

  it "deletes an app" do
    app = SmartApp.create!(payload)

    with_admin_token(nil) { delete "/admin/smart_apps/#{app.id}" }

    expect(response).to have_http_status(:no_content)
    expect(SmartApp.exists?(app.id)).to be(false)
  end

  it "requires the admin session when ADMIN_TOKEN is configured" do
    with_admin_token("s3cret") { get "/admin/smart_apps" }

    expect(response).to have_http_status(:unauthorized)
  end

  it "is closed in production without ADMIN_TOKEN" do
    allow(Rails.env).to receive(:production?).and_return(true)

    with_admin_token(nil) { get "/admin/smart_apps" }

    expect(response).to have_http_status(:service_unavailable)
  end
end
