require "rails_helper"

RSpec.describe "Master::Holidays", type: :request do
  def with_admin_token(token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  it "期間で絞り、日付順に返す" do
    Master::Holiday.create!(holiday_date: Date.new(2026, 12, 30), name: "年末休診", kind: "facility")
    Master::Holiday.create!(holiday_date: Date.new(2026, 11, 23), name: "勤労感謝の日")
    Master::Holiday.create!(holiday_date: Date.new(2027, 1, 1), name: "元日")

    with_admin_token(nil) { get "/master/holidays", params: { from: "2026-11-01", to: "2026-12-31" } }
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["items"].map { |i| i["holiday_date"] }).to eq(%w[2026-11-23 2026-12-30])
  end

  it "休診日を登録し、同じ日の二重登録を弾く" do
    with_admin_token(nil) do
      post "/master/holidays", params: { holiday_date: "2026-12-29", name: "年末休診", kind: "facility" }, as: :json
    end
    expect(response).to have_http_status(:created)

    with_admin_token(nil) do
      post "/master/holidays", params: { holiday_date: "2026-12-29", name: "重複", kind: "facility" }, as: :json
    end
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "内閣府 CSV を取り込む" do
    with_admin_token(nil) do
      post "/master/holidays/import", params: { file: fixture_file_upload("holidays_sample.csv") }
    end
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq("imported" => 3, "skipped" => 0)
  end
end
