require "rails_helper"

RSpec.describe OralExamCodeSeed do
  it "同梱の CSV を入れ、2 回目は増やさない" do
    Master::OralExamCode.delete_all

    first = described_class.load!
    expect(first.created).to be > 800
    expect(Master::OralExamCode.find_by(item: "TP-21", code: "01"))
      .to have_attributes(tf_ref: "TF-16", cs_name: "JDASTP21", cs_oid: "1.2.392.200354.1.2.1.5.3.21")

    second = described_class.load!
    expect(second.created).to eq(0)
    expect(second.kept).to eq(first.created)
  end
end
