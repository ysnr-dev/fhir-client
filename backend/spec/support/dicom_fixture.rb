# spec 用の最小の DICOM(Part 10)バイト列を組み立てる。
# File Meta Information(group 0002、Explicit VR Little Endian)と、その後ろに
# データセットの代わりのダミー要素 1 つだけを持つ。
module DicomFixture
  SOP_CLASS_CT = "1.2.840.10008.5.1.4.1.1.2".freeze
  EXPLICIT_VR_LE = "1.2.840.10008.1.2.1".freeze

  module_function

  def bytes(sop_instance_uid:, sop_class_uid: SOP_CLASS_CT, transfer_syntax_uid: EXPLICIT_VR_LE, preamble: true)
    meta = +"".b
    meta << element(0x0002, 0x0001, "OB", "\x00\x01".b)
    meta << element(0x0002, 0x0002, "UI", uid(sop_class_uid))
    meta << element(0x0002, 0x0003, "UI", uid(sop_instance_uid))
    meta << element(0x0002, 0x0010, "UI", uid(transfer_syntax_uid))
    group_length = element(0x0002, 0x0000, "UL", [meta.bytesize].pack("V"))
    dataset = element(0x0008, 0x0060, "CS", "CT")

    head = preamble ? ("\0".b * 128) + "DICM".b : +"".b
    head + group_length + meta + dataset
  end

  def upload(**options)
    file = Tempfile.new(["dicom", ".dcm"], binmode: true)
    file.write(bytes(**options))
    file.rewind
    Rack::Test::UploadedFile.new(file.path, "application/dicom", true)
  end

  def uid(value)
    value.length.odd? ? "#{value}\0" : value
  end

  def element(group, elem, vr, value)
    header = [group, elem].pack("v2") + vr
    if DicomHeader::LONG_VRS.include?(vr)
      header + "\0\0".b + [value.bytesize].pack("V") + value.b
    else
      header + [value.bytesize].pack("v") + value.b
    end
  end
end
