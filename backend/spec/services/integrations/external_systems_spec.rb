require "rails_helper"

RSpec.describe Integrations::ExternalSystems do
  describe "定義" do
    it "declares the receipt computer as a system that is reached over an API" do
      definition = described_class.find!(ExternalSystemConnection::RECEIPT_COMPUTER)

      expect(definition.section?(:connection)).to be(true)
      expect(definition.system_types).to eq(%w[orca])
      expect(definition.adapter_class("orca")).to eq(Integrations::Orca::Adapter)
      expect(definition.code_kinds("orca").map { |kind| kind[:key] }).to eq(%w[department physician])
      expect(definition.option_fields("orca").map { |field| field[:key] }).to eq(%w[api_prefix])
    end

    it "has no definition for a key that is not registered" do
      expect(described_class.find("unknown_system")).to be_nil
      expect { described_class.find!("unknown_system") }.to raise_error(ActiveRecord::RecordNotFound)
    end
  end

  describe "API で繋がないシステム" do
    let(:definition) do
      described_class::Definition.new(
        key: "paper_ledger",
        label: "紙の台帳",
        fields: [{ key: "ledger_no", label: "台帳番号", required: true }]
      )
    end

    it "has neither a connection nor a product to choose" do
      expect(definition.section?(:connection)).to be(false)
      expect(definition.system_types).to be_empty
      expect(definition.code_kinds("")).to be_empty
      expect(definition.required_field_keys).to eq(%w[ledger_no])
    end

    it "is usable once the declared fields are filled, without any credentials" do
      allow(described_class).to receive(:find).with("paper_ledger").and_return(definition)
      config = ExternalSystemConnection::EffectiveConfig.new(
        system_key: "paper_ledger", enabled: true, options: {}
      )

      expect(config.usable?).to be(false)

      config.options = { "ledger_no" => "A-1" }
      expect(config.usable?).to be(true)

      config.enabled = false
      expect(config.usable?).to be(false)
    end
  end
end
