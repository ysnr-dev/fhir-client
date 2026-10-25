require "rails_helper"

RSpec.describe "FacilitySettings", type: :request do
  let(:admin_token) { "s3cret-admin-passphrase" }

  def with_admin_token(token = admin_token)
    previous = ENV["ADMIN_TOKEN"]
    token.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = token
    yield
  ensure
    previous.nil? ? ENV.delete("ADMIN_TOKEN") : ENV["ADMIN_TOKEN"] = previous
  end

  describe "GET /facility_settings" do
    it "returns nil while the self organization is unset" do
      with_admin_token(nil) { get "/facility_settings" }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["self_organization_id"]).to be_nil
      # 未設定でも看護指示の既定時刻は既定値で返る
      expect(body["nursing_schedule"]).to eq(FacilitySettings::DEFAULT_NURSING_SCHEDULE)
      expect(body["meal_schedule"]).to eq(FacilitySettings::DEFAULT_MEAL_SCHEDULE)
      expect(body["vital_thresholds"]).to eq(FacilitySettings::DEFAULT_VITAL_THRESHOLDS)
      expect(body["water_balance"]).to eq(FacilitySettings::DEFAULT_WATER_BALANCE)
      expect(body["medication_schedule"]).to eq(FacilitySettings::DEFAULT_MEDICATION_SCHEDULE)
      expect(body["document_reminder"]).to eq(FacilitySettings::DEFAULT_DOCUMENT_REMINDER)
      expect(body["prescription_category"]).to eq(FacilitySettings::DEFAULT_PRESCRIPTION_CATEGORY)
    end

    it "returns the configured self organization" do
      FacilitySettings.current.update!(self_organization_fhir_id: "org-self")

      with_admin_token(nil) { get "/facility_settings" }

      expect(JSON.parse(response.body)).to include("self_organization_id" => "org-self")
    end

    it "is readable by a logged-in practitioner user (管理者専用ではない)" do
      with_admin_token do
        User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
        post "/auth/session", params: { login_id: "tanaka", password: "password123" }, as: :json
        expect(response).to have_http_status(:ok)

        get "/facility_settings"

        expect(response).to have_http_status(:ok)
      end
    end

    it "rejects an unauthenticated request when ADMIN_TOKEN is configured" do
      with_admin_token { get "/facility_settings" }

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "PATCH /facility_settings" do
    it "stores the self organization id" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { self_organization_id: "org-self" }, as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(FacilitySettings.self_organization_id).to eq("org-self")
    end

    it "clears the self organization when given a blank value" do
      FacilitySettings.current.update!(self_organization_fhir_id: "org-self")

      with_admin_token(nil) do
        patch "/facility_settings", params: { self_organization_id: "" }, as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to include("self_organization_id" => nil)
      expect(FacilitySettings.self_organization_id).to be_nil
    end
  end

  describe "PATCH /facility_settings (nursing_schedule)" do
    it "stores the nursing schedule without touching the self organization" do
      FacilitySettings.current.update!(self_organization_fhir_id: "org-self")

      with_admin_token(nil) do
        patch "/facility_settings",
              params: { nursing_schedule: { daily: { "3" => %w[08:00 13:00 19:00] } } },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["self_organization_id"]).to eq("org-self")
      expect(body["nursing_schedule"]["daily"]["3"]).to eq(%w[08:00 13:00 19:00])
      # 渡していない回数は既定値のまま
      expect(body["nursing_schedule"]["daily"]["2"]).to eq(%w[10:00 18:00])
      expect(body["nursing_schedule"]["interval_start"]).to eq("06:00")
    end

    it "rejects a malformed time" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: { nursing_schedule: { interval_start: "6時" } },
              as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /facility_settings (advisory_severity)" do
    it "stores per-kind overrides, defaults to empty and rejects raising or unknown kinds" do
      with_admin_token(nil) { get "/facility_settings" }
      expect(JSON.parse(response.body)["advisory_severity"]).to eq({})

      with_admin_token(nil) do
        patch "/facility_settings", params: { advisory_severity: { egfr: "off", duplicate: "info" } }, as: :json
      end
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["advisory_severity"]).to eq("egfr" => "off", "duplicate" => "info")

      with_admin_token(nil) do
        patch "/facility_settings", params: { advisory_severity: { dose: "block" } }, as: :json
      end
      expect(response).to have_http_status(:unprocessable_content)

      with_admin_token(nil) do
        patch "/facility_settings", params: { advisory_severity: { "Bad Kind" => "info" } }, as: :json
      end
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /facility_settings (meal_schedule)" do
    it "stores the meal schedule and fills the rest with defaults" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { meal_schedule: { lunch: "11:30" } }, as: :json
      end

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["meal_schedule"]).to eq("breakfast" => "08:00", "lunch" => "11:30", "dinner" => "18:00")
    end

    it "rejects a malformed time" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { meal_schedule: { dinner: "夕方" } }, as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /facility_settings (vital_thresholds)" do
    it "stores the thresholds without touching the other settings" do
      FacilitySettings.current.update!(self_organization_fhir_id: "org-self")

      with_admin_token(nil) do
        patch "/facility_settings",
              params: { vital_thresholds: { "8310-5" => { high: 38.0 }, "2708-6" => { low: 93 } } },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["self_organization_id"]).to eq("org-self")
      expect(body["vital_thresholds"]["8310-5"]).to eq("high" => 38.0)
      expect(body["vital_thresholds"]["2708-6"]).to eq("low" => 93)
      # 渡していない項目は既定値のまま
      expect(body["vital_thresholds"]["8867-4"]).to eq("low" => 50, "high" => 100)
    end

    it "rejects a non-numeric bound" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { vital_thresholds: { "8310-5" => { high: "38度" } } }, as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /facility_settings (water_balance)" do
    it "stores the chosen items without touching the other settings" do
      FacilitySettings.current.update!(self_organization_fhir_id: "org-self")

      with_admin_token(nil) do
        patch "/facility_settings",
              params: { water_balance: { in: %w[31000010], out: %w[31000021] } },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["self_organization_id"]).to eq("org-self")
      expect(body["water_balance"]).to eq("in" => %w[31000010], "out" => %w[31000021])
    end

    it "rejects a value that is not a manage number" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { water_balance: { in: %w[abc] } }, as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /facility_settings (medication_schedule)" do
    it "stores the offsets and times without touching the other settings" do
      FacilitySettings.current.update!(self_organization_fhir_id: "org-self")

      with_admin_token(nil) do
        patch "/facility_settings",
              params: {
                medication_schedule: {
                  before_meal_minutes: 15,
                  after_meal_minutes: 45,
                  bedtime: "22:30",
                  wake_time: "05:30"
                }
              },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["self_organization_id"]).to eq("org-self")
      expect(body["medication_schedule"]).to eq(
        "before_meal_minutes" => 15,
        "after_meal_minutes" => 45,
        "bedtime" => "22:30",
        "wake_time" => "05:30"
      )
    end

    it "accepts offsets sent as strings (フォームからの送信)" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: { medication_schedule: { before_meal_minutes: "20" } },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["medication_schedule"]["before_meal_minutes"]).to eq(20)
    end

    it "rejects a time that is not HH:MM" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { medication_schedule: { bedtime: "abc" } }, as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /facility_settings (nursing_acuity)" do
    it "基準の組を保存し、割合2を空にできる" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: { nursing_acuity: { ratio1: %w[A2+B3 A3 C1], ratio2: [] } },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["nursing_acuity"]).to eq(
        "form" => "general-2026", "ratio1" => %w[A2+B3 A3 C1], "ratio2" => [], "units" => {}, "emergency_years" => {},
      )
    end

    it "項目に該当する組(#A2)を受け、書き方が違えば 422" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { nursing_acuity: { ratio1: %w[#A2+#A7 #A6-5 A1] } }, as: :json
      end
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["nursing_acuity"]["ratio1"]).to eq(%w[#A2+#A7 #A6-5 A1])

      with_admin_token(nil) do
        patch "/facility_settings", params: { nursing_acuity: { ratio1: ["A>=3"] } }, as: :json
      end
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "届出単位と救急搬送の件数を保存し、数値の文字列は数に寄せる" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: {
                nursing_acuity: {
                  units: {
                    "ward-1" => { kind: "ward", category: "acute-1", method: "II", beds: "40", ratio1: "27.5" },
                    "room-icu" => { kind: "room", category: "icu-1", method: "I" }
                  },
                  emergency_years: { "2025" => { transports: "1200", admissions: { "ward-1" => "300" } } }
                }
              },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)["nursing_acuity"]
      # 空欄のキーは返さない(区分の既定を使う)。
      expect(body["units"]).to eq(
        "ward-1" => { "kind" => "ward", "category" => "acute-1", "method" => "II", "beds" => 40, "ratio1" => 27.5 },
        "room-icu" => { "kind" => "room", "category" => "icu-1", "method" => "I" }
      )
      expect(body["emergency_years"]).to eq("2025" => { "transports" => 1200, "admissions" => { "ward-1" => 300 } })
    end

    it "届出区分が無いもの・年度が 4 桁でないもの・基準値が 100 を超えるものは 422" do
      [
        { units: { "w" => { kind: "ward", category: "acute-9", method: "I" } } },
        { emergency_years: { "R7" => { transports: 1 } } },
        { units: { "w" => { kind: "ward", category: "acute-1", method: "I", ratio1: 120 } } }
      ].each do |payload|
        with_admin_token(nil) do
          patch "/facility_settings", params: { nursing_acuity: payload }, as: :json
        end
        expect(response).to have_http_status(:unprocessable_content), payload.inspect
      end
    end
  end

  describe "PATCH /facility_settings (admission_documents)" do
    it "テンプレートの url と日数を保存し、渡さなかった項目は既定値で返す" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: {
                admission_documents: {
                  admission_plan_template: "http://fhir-client.local/Questionnaire/admission-plan-01",
                  admission_plan_days: "5",
                },
              },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["admission_documents"]).to eq(
        "admission_plan_template" => "http://fhir-client.local/Questionnaire/admission-plan-01",
        "admission_plan_days" => 5,
        "nursing_summary_days" => 7,
      )
    end

    it "版付きの canonical(| を含む)と負の日数は 422" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: { admission_documents: { admission_plan_template: "http://x/Questionnaire/a|1.0.0" } },
              as: :json
      end
      expect(response).to have_http_status(:unprocessable_content)

      with_admin_token(nil) do
        patch "/facility_settings", params: { admission_documents: { nursing_summary_days: -1 } }, as: :json
      end
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /facility_settings (pressure_ulcer)" do
    it "DESIGN-R のテンプレートの url を保存し、版付きは 422" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: { pressure_ulcer: { template: "http://fhir-client.local/Questionnaire/pu-designr-local" } }, as: :json
      end
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["pressure_ulcer"]).to eq(
        "template" => "http://fhir-client.local/Questionnaire/pu-designr-local",
      )

      with_admin_token(nil) do
        patch "/facility_settings", params: { pressure_ulcer: { template: "http://x/Questionnaire/a|1.0.0" } }, as: :json
      end
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /facility_settings (cancer_registry)" do
    it "院内がん登録のテンプレートの url を保存し、既定は同梱の HBCR_01" do
      with_admin_token(nil) { get "/facility_settings" }
      expect(JSON.parse(response.body)["cancer_registry"]).to eq(
        "template" => "http://fhir-client.local/Questionnaire/hbcr-01",
      )

      with_admin_token(nil) do
        patch "/facility_settings",
              params: { cancer_registry: { template: "http://fhir-client.local/Questionnaire/hbcr-local" } }, as: :json
      end
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["cancer_registry"]).to eq(
        "template" => "http://fhir-client.local/Questionnaire/hbcr-local",
      )

      with_admin_token(nil) do
        patch "/facility_settings", params: { cancer_registry: { template: "" } }, as: :json
      end
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /facility_settings (infectious_disease_report)" do
    it "発生届のテンプレートの url を保存し、既定は同梱の IDSC_NOTIFY_01" do
      with_admin_token(nil) { get "/facility_settings" }
      expect(JSON.parse(response.body)["infectious_disease_report"]).to eq(
        "template" => "http://fhir-client.local/Questionnaire/idsc-notify-01",
      )

      with_admin_token(nil) do
        patch "/facility_settings",
              params: { infectious_disease_report: { template: "http://fhir-client.local/Questionnaire/idsc-local" } }, as: :json
      end
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["infectious_disease_report"]).to eq(
        "template" => "http://fhir-client.local/Questionnaire/idsc-local",
      )
    end
  end

  describe "PATCH /facility_settings (ncd_registration)" do
    it "症例登録のテンプレートの url を保存し、既定は同梱の NCD_CASE_01" do
      with_admin_token(nil) { get "/facility_settings" }
      expect(JSON.parse(response.body)["ncd_registration"]).to eq(
        "template" => "http://fhir-client.local/Questionnaire/ncd-case-01",
      )

      with_admin_token(nil) do
        patch "/facility_settings",
              params: { ncd_registration: { template: "http://fhir-client.local/Questionnaire/ncd-local" } }, as: :json
      end
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["ncd_registration"]).to eq(
        "template" => "http://fhir-client.local/Questionnaire/ncd-local",
      )
    end
  end

  describe "PATCH /facility_settings (document_reminder)" do
    it "stores the days and returns the merged defaults" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: { document_reminder: { discharge_summary_days: "7" } },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["document_reminder"]).to eq("discharge_summary_days" => 7)
    end

    it "rejects a negative number of days" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { document_reminder: { discharge_summary_days: -1 } }, as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /facility_settings (prescription_category)" do
    it "stores the default category of each setting" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: { prescription_category: { inpatient: "temporary", outpatient: "external" } },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["prescription_category"])
        .to eq("inpatient" => "temporary", "outpatient" => "external")
    end

    it "accepts an empty code (初期値を決めない)" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { prescription_category: { inpatient: "" } }, as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["prescription_category"]).to eq("inpatient" => "", "outpatient" => "")
    end

    it "rejects a code that belongs to the other setting" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: { prescription_category: { outpatient: "temporary" } },
              as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /facility_settings (consult_default_templates)" do
    let(:canonical) { "http://fhir-client.local/Questionnaire/consult-purpose-radiotherapy-01|1.0.0" }

    it "stores the default template of each department" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: { consult_default_templates: { "org-rt" => canonical } },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["consult_default_templates"]).to eq("org-rt" => canonical)
    end

    it "rejects a value that is not a canonical URL" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { consult_default_templates: { "org-rt" => "x" } }, as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /facility_settings (nursing_profile)" do
    let(:admission) { "http://fhir-client.local/Questionnaire/nursing-profile-admission-01" }
    let(:adl) { "http://fhir-client.local/Questionnaire/nursing-profile-adl-01" }

    it "returns no sections by default" do
      get "/facility_settings"

      expect(JSON.parse(response.body)["nursing_profile"]).to eq("templates" => [])
    end

    it "stores the templates in the given order" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { nursing_profile: { templates: [adl, admission] } }, as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["nursing_profile"]).to eq("templates" => [adl, admission])
    end

    it "rejects a canonical with a version" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: { nursing_profile: { templates: ["#{admission}|1.0.0"] } },
              as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "rejects the same template twice" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { nursing_profile: { templates: [adl, adl] } }, as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PATCH /facility_settings (bulk_vital_entry)" do
    it "returns the default columns" do
      get "/facility_settings"

      expect(JSON.parse(response.body)["bulk_vital_entry"]).to eq(FacilitySettings::DEFAULT_BULK_VITAL_ENTRY)
    end

    it "accepts the oxygen flow and JCS columns" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { bulk_vital_entry: { items: %w[jcs oxygen_flow] } }, as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["bulk_vital_entry"]).to eq("items" => %w[jcs oxygen_flow])
    end

    it "stores the columns in the given order" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { bulk_vital_entry: { items: %w[weight temperature] } }, as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["bulk_vital_entry"]).to eq("items" => %w[weight temperature])
    end

    it "rejects an unknown column" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { bulk_vital_entry: { items: %w[height] } }, as: :json
      end

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "rejects no columns and the same column twice" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { bulk_vital_entry: { items: [] } }, as: :json
        expect(response).to have_http_status(:unprocessable_content)

        patch "/facility_settings", params: { bulk_vital_entry: { items: %w[pulse pulse] } }, as: :json
        expect(response).to have_http_status(:unprocessable_content)
      end
    end
  end

  describe "PATCH /facility_settings (karte_card_order)" do
    it "orders by time by default" do
      get "/facility_settings"

      expect(JSON.parse(response.body)["karte_card_order"]).to eq("mode" => "time", "kinds" => [])
    end

    it "stores the kinds in the given order" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: { karte_card_order: { mode: "kind", kinds: %w[prescription note lab-order] } },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["karte_card_order"]).to eq(
        "mode" => "kind", "kinds" => %w[prescription note lab-order]
      )
    end

    it "rejects an unknown mode and the same kind twice" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { karte_card_order: { mode: "day", kinds: [] } }, as: :json
        expect(response).to have_http_status(:unprocessable_content)

        patch "/facility_settings", params: { karte_card_order: { mode: "kind", kinds: %w[note note] } }, as: :json
        expect(response).to have_http_status(:unprocessable_content)
      end
    end
  end

  describe "PATCH /facility_settings (early_warning)" do
    it "is disabled by default" do
      get "/facility_settings"

      expect(JSON.parse(response.body)["early_warning"]).to eq(
        "enabled" => false, "notify_band" => "medium", "show_qsofa" => true
      )
    end

    it "stores the settings" do
      with_admin_token(nil) do
        patch "/facility_settings",
              params: { early_warning: { enabled: true, notify_band: "high", show_qsofa: false } },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["early_warning"]).to eq(
        "enabled" => true, "notify_band" => "high", "show_qsofa" => false
      )
    end

    it "rejects an unknown band and a string for a boolean" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { early_warning: { notify_band: "low" } }, as: :json
        expect(response).to have_http_status(:unprocessable_content)

        patch "/facility_settings", params: { early_warning: { enabled: "true" } }, as: :json
        expect(response).to have_http_status(:unprocessable_content)
      end
    end
  end

  # 設定は settings(jsonb)1 列にまとめて入るので、1 項目の保存が他の項目を
  # 消していないことを見る。
  describe "PATCH /facility_settings (渡した項目だけ差し替える)" do
    it "keeps the settings that were not sent" do
      with_admin_token(nil) do
        patch "/facility_settings", params: { meal_schedule: { lunch: "11:30" } }, as: :json
        patch "/facility_settings",
              params: { document_reminder: { discharge_summary_days: 7 } },
              as: :json
      end

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["meal_schedule"]["lunch"]).to eq("11:30")
      expect(body["document_reminder"]).to eq("discharge_summary_days" => 7)
    end
  end

  describe "PATCH /facility_settings (権限)" do
    it "is writable by a logged-in practitioner user (管理者専用ではない)" do
      with_admin_token do
        User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
        post "/auth/session", params: { login_id: "tanaka", password: "password123" }, as: :json
        csrf = JSON.parse(response.body)["csrf_token"]

        patch "/facility_settings", params: { self_organization_id: "org-self" }, as: :json,
                                    headers: { "X-CSRF-Token" => csrf }

        expect(response).to have_http_status(:ok)
        expect(FacilitySettings.current.self_organization_id).to eq("org-self")
      end
    end

    it "rejects a session request without the CSRF token" do
      with_admin_token do
        User.create!(login_id: "tanaka", password: "password123", practitioner_fhir_id: "prac-1")
        post "/auth/session", params: { login_id: "tanaka", password: "password123" }, as: :json

        patch "/facility_settings", params: { self_organization_id: "org-self" }, as: :json

        expect(response).to have_http_status(:forbidden)
      end
    end

    it "rejects an unauthenticated request when ADMIN_TOKEN is configured" do
      with_admin_token { patch "/facility_settings", params: { self_organization_id: "org-self" }, as: :json }

      expect(response).to have_http_status(:unauthorized)
    end
  end
end
