require "rails_helper"

RSpec.describe FacilitySettings do
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

  describe ".nursing_schedule" do
    it "returns the defaults when nothing is stored" do
      expect(described_class.nursing_schedule).to eq(described_class::DEFAULT_NURSING_SCHEDULE)
    end

    it "merges a partially stored schedule over the defaults" do
      described_class.current.update!(nursing_schedule: { "daily" => { "3" => %w[08:00 13:00 19:00] } })

      schedule = described_class.nursing_schedule
      expect(schedule["daily"]["3"]).to eq(%w[08:00 13:00 19:00])
      expect(schedule["daily"]["1"]).to eq(%w[10:00])
      expect(schedule["interval_start"]).to eq("06:00")
    end

    it "rejects a time that is not HH:MM" do
      settings = described_class.current
      settings.nursing_schedule = { "daily" => { "1" => ["25:00"] } }

      expect(settings).not_to be_valid
    end
  end

  describe ".meal_schedule" do
    it "returns the defaults when nothing is stored" do
      expect(described_class.meal_schedule).to eq(described_class::DEFAULT_MEAL_SCHEDULE)
    end

    it "fills missing meals with the defaults" do
      described_class.current.update!(meal_schedule: { "lunch" => "11:30" })

      expect(described_class.meal_schedule).to eq("breakfast" => "08:00", "lunch" => "11:30", "dinner" => "18:00")
    end

    it "rejects a time that is not HH:MM" do
      settings = described_class.current
      settings.meal_schedule = { "dinner" => "18時" }

      expect(settings).not_to be_valid
    end

    it "rejects an unknown meal" do
      settings = described_class.current
      settings.meal_schedule = { "snack" => "15:00" }

      expect(settings).not_to be_valid
    end
  end

  describe ".vital_thresholds" do
    it "returns the defaults when nothing is stored" do
      expect(described_class.vital_thresholds).to eq(described_class::DEFAULT_VITAL_THRESHOLDS)
    end

    it "replaces a stored item as a whole (上限を空にした状態を保存できる)" do
      described_class.current.update!(vital_thresholds: { "8310-5" => { "high" => 38.0 }, "8867-4" => { "low" => 40 } })

      thresholds = described_class.vital_thresholds
      expect(thresholds["8310-5"]).to eq("high" => 38.0)
      expect(thresholds["8867-4"]).to eq("low" => 40)
      expect(thresholds["8480-6"]).to eq("low" => 90, "high" => 180)
    end

    it "rejects an unknown code" do
      settings = described_class.current
      settings.vital_thresholds = { "29463-7" => { "high" => 100 } }

      expect(settings).not_to be_valid
    end

    it "rejects a non-numeric bound" do
      settings = described_class.current
      settings.vital_thresholds = { "8310-5" => { "high" => "38度" } }

      expect(settings).not_to be_valid
    end

    it "rejects low >= high" do
      settings = described_class.current
      settings.vital_thresholds = { "8867-4" => { "low" => 100, "high" => 100 } }

      expect(settings).not_to be_valid
    end
  end

  describe ".self_organization_id" do
    it "returns nil when unset" do
      expect(described_class.self_organization_id).to be_nil
    end

    it "returns nil for a blank value (自院の指定を外した状態)" do
      described_class.current.update!(self_organization_fhir_id: "")

      expect(described_class.self_organization_id).to be_nil
    end

    it "returns the stored Organization id" do
      described_class.current.update!(self_organization_fhir_id: "org-1")

      expect(described_class.self_organization_id).to eq("org-1")
    end
  end
end
