require "rails_helper"
require "support/dicom_fixture"

RSpec.describe DicomHeader do
  let(:sop_uid) { "1.2.392.200036.9116.2.5.1.1" }

  it "reads the UIDs from the file meta information" do
    header = described_class.new(DicomFixture.bytes(sop_instance_uid: sop_uid, transfer_syntax_uid: "1.2.840.10008.1.2.4.70"))

    expect(header.sop_instance_uid).to eq(sop_uid)
    expect(header.sop_class_uid).to eq(DicomFixture::SOP_CLASS_CT)
    expect(header.transfer_syntax_uid).to eq("1.2.840.10008.1.2.4.70")
  end

  it "strips the NUL padding of an odd-length UID" do
    header = described_class.new(DicomFixture.bytes(sop_instance_uid: "1.2.3"))

    expect(header.sop_instance_uid).to eq("1.2.3")
  end

  it "reads from an IO and rewinds it" do
    io = StringIO.new(DicomFixture.bytes(sop_instance_uid: sop_uid))

    expect(described_class.read(io).sop_instance_uid).to eq(sop_uid)
    expect(io.pos).to eq(0)
  end

  it "rejects a file without the DICM magic" do
    expect { described_class.new(DicomFixture.bytes(sop_instance_uid: sop_uid, preamble: false)) }
      .to raise_error(DicomHeader::InvalidFile)
    expect { described_class.new("%PDF-1.7".b) }.to raise_error(DicomHeader::InvalidFile)
  end

  it "rejects a file whose meta information has no SOP Instance UID" do
    bytes = ("\0".b * 128) + "DICM".b + DicomFixture.element(0x0008, 0x0060, "CS", "CT")

    expect { described_class.new(bytes) }.to raise_error(DicomHeader::InvalidFile)
  end
end
