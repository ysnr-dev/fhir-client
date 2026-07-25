require "rails_helper"

RSpec.describe FhirConnectionSettings do
  # ENV を一時的に差し替えて元へ戻すヘルパー。
  def with_env(vars)
    old = {}
    vars.each { |k, v| old[k] = ENV[k]; v.nil? ? ENV.delete(k) : ENV[k] = v }
    yield
  ensure
    old.each { |k, v| v.nil? ? ENV.delete(k) : (ENV[k] = v) }
  end

  describe "single-row enforcement" do
    it "rejects a second row" do
      described_class.current
      second = described_class.new

      expect(second).not_to be_valid
      expect(second.errors[:singleton_guard]).to be_present
    end

    it ".current returns the same row on repeated calls" do
      expect(described_class.current.id).to eq(described_class.current.id)
    end
  end

  describe "client_secret encryption" do
    it "stores the secret encrypted at rest but reads it back in the clear" do
      row = described_class.current
      row.update!(client_secret: "supersecret")

      raw = described_class.connection.select_value(
        "SELECT client_secret FROM fhir_connection_settings WHERE id = #{row.id}"
      )
      expect(raw).not_to include("supersecret")
      expect(described_class.current.client_secret).to eq("supersecret")
    end
  end

  describe "fhir_admin_token encryption" do
    it "stores the admin token encrypted at rest but reads it back in the clear" do
      row = described_class.current
      row.update!(fhir_admin_token: "admin-shared-token")

      raw = described_class.connection.select_value(
        "SELECT fhir_admin_token FROM fhir_connection_settings WHERE id = #{row.id}"
      )
      expect(raw).not_to include("admin-shared-token")
      expect(described_class.current.fhir_admin_token).to eq("admin-shared-token")
    end
  end

  describe ".effective admin_token" do
    it "prefers the DB value over ENV" do
      with_env("FHIR_ADMIN_TOKEN" => "env-admin") do
        described_class.current.update!(fhir_admin_token: "db-admin")

        expect(described_class.effective.admin_token).to eq("db-admin")
      end
    end

    it "falls back to ENV when the DB value is blank" do
      with_env("FHIR_ADMIN_TOKEN" => "env-admin") do
        expect(described_class.effective.admin_token).to eq("env-admin")
      end
    end

    it "is nil when neither is set" do
      with_env("FHIR_ADMIN_TOKEN" => nil) do
        expect(described_class.effective.admin_token).to be_nil
      end
    end
  end

  describe ".effective" do
    it "prefers DB values over ENV" do
      with_env("FHIR_SERVER_BASE_URL" => "http://env-server", "FHIR_SERVER_CLIENT_ID" => "env-cid") do
        described_class.current.update!(base_url: "http://db-server", client_id: "db-cid")

        eff = described_class.effective
        expect(eff.base_url).to eq("http://db-server")
        expect(eff.client_id).to eq("db-cid")
      end
    end

    it "falls back to ENV when DB values are blank" do
      with_env(
        "FHIR_SERVER_BASE_URL" => "http://env-server",
        "FHIR_SERVER_CLIENT_ID" => "env-cid",
        "FHIR_SERVER_CLIENT_SECRET" => "env-sec"
      ) do
        eff = described_class.effective
        expect(eff.base_url).to eq("http://env-server")
        expect(eff.client_id).to eq("env-cid")
        expect(eff.client_secret).to eq("env-sec")
      end
    end

    it "defaults base_url and token_path when neither DB nor ENV set" do
      with_env("FHIR_SERVER_BASE_URL" => nil) do
        eff = described_class.effective
        expect(eff.base_url).to eq("http://localhost:3000")
        expect(eff.token_path).to eq("/oauth/token")
      end
    end
  end

  describe ".config_version" do
    it "reflects the row's updated_at" do
      expect(described_class.config_version).to eq(described_class.current.updated_at.to_f)
    end
  end
end
