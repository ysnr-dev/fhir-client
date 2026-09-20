require "rails_helper"

RSpec.describe Integrations::ReceiptComputer::PatientResource do
  def record(**overrides)
    Integrations::ReceiptComputer::Records::PatientRecord.new(
      { number: "00002", family: "テスト", given: "太郎",
        family_kana: "テスト", given_kana: "タロウ",
        birth_date: "1990-01-01", gender: "male" }.merge(overrides)
    )
  end

  # レセコンは 1009 の連番桁数でゼロ埋めし、カルテは入力したまま持つ。
  # 桁揃えの違いで同じ患者を二重に作らないようにする。
  describe ".candidate_numbers" do
    it "treats a zero-padded number and its bare form as the same patient" do
      expect(described_class.candidate_numbers("00002")).to eq(%w[00002 2])
      expect(described_class).to be_same_number("00002", "2")
    end

    it "leaves a non-numeric 患者番号 alone" do
      expect(described_class.candidate_numbers("A-01")).to eq(["A-01"])
      expect(described_class).not_to be_same_number("A-01", "01")
    end
  end

  describe ".build" do
    it "writes the 漢字名 and カナ名 as separate name entries" do
      names = described_class.build(record)["name"]

      expect(names.first).to include("family" => "テスト", "text" => "テスト　太郎")
      expect(names.last["extension"].first["valueCode"]).to eq("SYL")
    end

    # ここで番号を振り直すと、カルテ側の参照や検索が一斉にずれる。
    it "keeps the 患者番号 the カルテ already uses when merging into an existing patient" do
      existing = { "resourceType" => "Patient", "id" => "p1",
                   "identifier" => [{ "system" => described_class::IDENTIFIER_SYSTEM, "value" => "2" }] }

      built = described_class.build(record, existing: existing)

      expect(described_class.number_of(built)).to eq("2")
    end

    it "uses the レセコン number for a patient the カルテ does not have yet" do
      expect(described_class.number_of(described_class.build(record))).to eq("00002")
    end

    # レセコンが持たない項目(かかりつけ、注意区分など)はカルテ側で付ける。
    it "leaves elements the レセコン does not own untouched" do
      existing = { "resourceType" => "Patient", "id" => "p1",
                   "identifier" => [{ "system" => described_class::IDENTIFIER_SYSTEM, "value" => "2" }],
                   "generalPractitioner" => [{ "reference" => "Practitioner/x" }] }

      built = described_class.build(record, existing: existing)

      expect(built["generalPractitioner"]).to eq([{ "reference" => "Practitioner/x" }])
    end

    it "keeps identifiers from other systems" do
      existing = { "resourceType" => "Patient",
                   "identifier" => [{ "system" => "urn:other", "value" => "zzz" }] }

      values = described_class.build(record, existing: existing)["identifier"]

      expect(values.last).to eq({ "system" => "urn:other", "value" => "zzz" })
    end
  end
end
