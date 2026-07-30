require "rails_helper"

RSpec.describe Reports::ItemIdMapper do
  describe ".convert" do
    it "keeps alphanumerics and underscores" do
      expect(described_class.convert("chief_complaint1")).to eq("chief_complaint1")
    end

    it "replaces each symbol allowed in linkId (jsp-4) with an underscore" do
      expect(described_class.convert("a-b.c!d#e%f/g:h;i?j@k~l")).to eq("a_b_c_d_e_f_g_h_i_j_k_l")
    end

    it "prefixes x when the converted id does not start with an alphanumeric" do
      expect(described_class.convert("-lead")).to eq("x_lead")
      expect(described_class.convert("_lead")).to eq("x_lead")
    end
  end

  describe "#tlf_id" do
    it "returns the converted id for the first occurrence" do
      mapper = described_class.new(["body/temp"])
      expect(mapper.tlf_id("body/temp")).to eq("body_temp")
    end

    it "appends _n for repeated occurrences" do
      mapper = described_class.new(["med-name"])
      expect(mapper.tlf_id("med-name", 2)).to eq("med_name_2")
      expect(mapper.tlf_id("med-name", 3)).to eq("med_name_3")
    end
  end

  describe "#image_id" do
    it "appends _img (and _n for repeats)" do
      mapper = described_class.new(["schema-body"])
      expect(mapper.image_id("schema-body")).to eq("schema_body_img")
      expect(mapper.image_id("schema-body", 2)).to eq("schema_body_img_2")
    end
  end

  describe "collision detection" do
    it "raises IdCollision when two linkIds convert to the same id" do
      expect { described_class.new(["a-b", "a.b"]) }
        .to raise_error(described_class::IdCollision, /a-b/)
    end

    it "accepts the same linkId appearing once" do
      expect { described_class.new(["a-b", "c-d"]) }.not_to raise_error
    end
  end
end
