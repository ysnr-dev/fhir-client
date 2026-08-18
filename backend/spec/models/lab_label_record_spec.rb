require "rails_helper"

RSpec.describe LabLabelRecord do
  describe ".check_digit" do
    it "computes M10W3 (same scheme as JAN/EAN)" do
      # EAN-13 の例: 490123456789 のチェックデジットは 4
      expect(described_class.check_digit("490123456789")).to eq("4")
      expect(described_class.check_digit("0000000001")).to eq("7")
      expect(described_class.check_digit("0000000000")).to eq("0")
    end
  end

  describe ".ensure_for" do
    it "creates a record with an 11-digit number (zero-padded id + check digit)" do
      record = described_class.ensure_for(
        order_fhir_id: "order-1", specimen_code: "212", container_code: "T03"
      )

      base = format("%010d", record.id)
      expect(record.label_number).to eq("#{base}#{described_class.check_digit(base)}")
      expect(record.label_number.length).to eq(11)
    end

    it "returns the same number for the same order and specimen (reprint)" do
      first = described_class.ensure_for(
        order_fhir_id: "order-1", specimen_code: "212", container_code: "T03"
      )
      again = described_class.ensure_for(
        order_fhir_id: "order-1", specimen_code: "212", container_code: "T03"
      )

      expect(again.id).to eq(first.id)
      expect(again.label_number).to eq(first.label_number)
      expect(described_class.count).to eq(1)
    end

    it "issues a different number per specimen within the same order" do
      serum = described_class.ensure_for(
        order_fhir_id: "order-1", specimen_code: "250", container_code: "T01"
      )
      blood = described_class.ensure_for(
        order_fhir_id: "order-1", specimen_code: "212", container_code: "T03"
      )

      expect(serum.label_number).not_to eq(blood.label_number)
    end

    it "backfills a number left blank by an interrupted issue" do
      record = described_class.create!(
        order_fhir_id: "order-1", specimen_code: "212", container_code: "T03"
      )

      ensured = described_class.ensure_for(
        order_fhir_id: "order-1", specimen_code: "212", container_code: "T03"
      )
      expect(ensured.id).to eq(record.id)
      expect(ensured.label_number).to be_present
    end
  end
end
