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
