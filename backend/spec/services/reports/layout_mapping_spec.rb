require "rails_helper"

RSpec.describe Reports::LayoutMapping do
  describe ".validate" do
    def errors_for(rules)
      described_class.validate(rules.is_a?(String) ? rules : JSON.generate(rules))
    end

    it "returns no errors for blank text" do
      expect(described_class.validate(nil)).to eq([])
      expect(described_class.validate("")).to eq([])
    end

    it "returns no errors for valid rules" do
      rules = [
        { "linkId" => "item-1", "tlfId" => "answer_1" },
        { "linkId" => "item-2", "code" => "01", "show" => %w[check_1 circle_1] },
        { "linkId" => "item-2", "answered" => true, "show" => ["check_any"] },
        { "linkId" => "item-2", "show" => ["check_implicit"] },
        { "meta" => "pt_name", "tlfId" => "patient_name" }
      ]
      expect(errors_for(rules)).to eq([])
    end

    it "rejects invalid JSON" do
      expect(errors_for("{not json")).to eq(["が JSON として不正です"])
    end

    it "rejects non-array JSON" do
      expect(errors_for({ "linkId" => "a" })).to eq(["はルールの配列(JSON Array)で指定してください"])
    end

    it "rejects a rule that is not an object" do
      expect(errors_for(["rule"]).join).to include("ルール1がオブジェクト")
    end

    it "rejects unknown keys" do
      expect(errors_for([{ "linkId" => "a", "tlfId" => "b", "hidden" => true }]).join)
        .to include("不明なキーがあります: hidden")
    end

    it "requires exactly one source and one target" do
      expect(errors_for([{ "tlfId" => "b" }]).join).to include("linkId か meta のどちらか一方")
      expect(errors_for([{ "linkId" => "a", "meta" => "pt_name", "tlfId" => "b" }]).join)
        .to include("linkId か meta のどちらか一方")
      expect(errors_for([{ "linkId" => "a" }]).join).to include("tlfId か show のどちらか一方")
      expect(errors_for([{ "linkId" => "a", "tlfId" => "b", "show" => ["c"] }]).join)
        .to include("tlfId か show のどちらか一方")
    end

    it "rejects code/answered without show and both together" do
      expect(errors_for([{ "linkId" => "a", "tlfId" => "b", "code" => "01" }]).join)
        .to include("code は show と組み合わせて")
      expect(errors_for([{ "linkId" => "a", "show" => ["b"], "code" => "01", "answered" => true }]).join)
        .to include("code と answered は同時に指定できません")
      expect(errors_for([{ "linkId" => "a", "show" => ["b"], "answered" => false }]).join)
        .to include("answered は true のみ")
    end

    it "rejects show combined with meta and unknown meta ids" do
      expect(errors_for([{ "meta" => "pt_name", "show" => ["b"] }]).join)
        .to include("show は linkId と組み合わせて")
      expect(errors_for([{ "meta" => "pt_typo", "tlfId" => "b" }]).join)
        .to include("\"pt_typo\" は予約プレースホルダーではありません")
    end

    it "rejects blank ids in show" do
      expect(errors_for([{ "linkId" => "a", "show" => [] }]).join)
        .to include("show は空でない文字列の配列")
      expect(errors_for([{ "linkId" => "a", "show" => [""] }]).join)
        .to include("show は空でない文字列の配列")
    end
  end

  describe "RESERVED_META_IDS" do
    it "matches the meta placeholders of ThinreportsRenderer" do
      renderer = Reports::ThinreportsRenderer.new(
        layout: nil, questionnaire: {}, response: {}, patient: {}
      )
      expect(renderer.send(:meta_values).keys).to match_array(described_class::RESERVED_META_IDS)
    end
  end

  describe ".parse" do
    it "returns nil for blank text" do
      expect(described_class.parse(nil)).to be_nil
      expect(described_class.parse("")).to be_nil
    end

    let(:mapping) do
      described_class.parse(JSON.generate([
        { "linkId" => "item-1", "tlfId" => "answer_1" },
        { "linkId" => "item-1", "tlfId" => "answer_1_copy" },
        { "linkId" => "item-2", "code" => "01", "show" => ["check_no"] },
        { "linkId" => "item-2", "code" => "02", "show" => %w[check_yes circle_1] },
        { "linkId" => "item-2", "answered" => true, "show" => ["check_any"] },
        { "meta" => "pt_name", "tlfId" => "patient_name" }
      ]))
    end

    it "collects value targets per linkId" do
      expect(mapping.value_targets("item-1")).to eq(%w[answer_1 answer_1_copy])
      expect(mapping.value_targets("unknown")).to eq([])
      expect(mapping.value_target_ids).to match_array(%w[answer_1 answer_1_copy])
    end

    it "collects meta targets" do
      expect(mapping.meta_targets("pt_name")).to eq(["patient_name"])
      expect(mapping.meta_targets("pt_kana")).to eq([])
    end

    it "collects all show target ids" do
      expect(mapping.show_target_ids).to contain_exactly("check_no", "check_yes", "circle_1", "check_any")
    end

    it "triggers show ids by matching answerCoding code" do
      answers = [{ "valueCoding" => { "code" => "02", "display" => "あり" } }]
      expect(mapping.triggered_show_ids("item-2", answers))
        .to contain_exactly("check_yes", "circle_1", "check_any")
    end

    it "triggers only the answered rule when no code matches" do
      answers = [{ "valueCoding" => { "code" => "99" } }]
      expect(mapping.triggered_show_ids("item-2", answers)).to contain_exactly("check_any")
    end

    it "matches any of multiple answers (checkbox)" do
      answers = [
        { "valueCoding" => { "code" => "01" } },
        { "valueCoding" => { "code" => "02" } }
      ]
      expect(mapping.triggered_show_ids("item-2", answers))
        .to contain_exactly("check_no", "check_yes", "circle_1", "check_any")
    end

    it "returns no ids for a linkId without show rules" do
      expect(mapping.triggered_show_ids("item-1", [{ "valueString" => "x" }])).to eq([])
    end
  end
end
