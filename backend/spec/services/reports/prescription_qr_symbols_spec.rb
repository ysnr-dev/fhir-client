require "rails_helper"

# 処方箋 QR コードの分割(連結)。1 シンボルに収まる処方は単独の QR、収まらない処方は
# レコードの境で分けて連結ヘッダ(位置・総数・パリティ)を付ける。
RSpec.describe Reports::PrescriptionQrSymbols do
  def line(text)
    (text + "\r\n").encode("Windows-31J")
  end

  def png?(bytes)
    bytes.start_with?("\x89PNG".b)
  end

  it "makes one plain symbol for a prescription that fits" do
    pngs = described_class.new([line("JAHIS11"), line("1,1,1234567,13,テスト病院")]).pngs

    expect(pngs.size).to eq(1)
    expect(png?(pngs.first)).to be(true)
  end

  it "caps a symbol below version 30 at level M" do
    expect(described_class.capacity).to eq((RQRCodeCore::QRMAXBITS[:m][29] - 40) / 8 - 1)
  end

  it "splits on record boundaries into balanced chunks" do
    lines = (1..200).map { |i| line("201,#{i},1,1,2,612170709,ノルバスク錠２．５ｍｇ,4,1,錠") }
    total = lines.sum(&:bytesize)
    chunks = described_class.new(lines).chunks

    # レコードの境で分けるので、バイト数だけで割った数より 1 つ多くなることはある。
    expect(chunks.size).to be_between((total.to_f / described_class.capacity).ceil, (total.to_f / described_class.capacity).ceil + 1)
    expect(chunks.join).to eq(lines.join)
    expect(chunks).to all(satisfy { |c| c.bytesize <= described_class.capacity && c.end_with?("\r\n".b) })
    # 大きさを揃える(最後だけ極端に小さいシンボルを作らない)。ずれはレコード数行ぶんまで。
    expect(chunks.map(&:bytesize).max - chunks.map(&:bytesize).min).to be < lines.map(&:bytesize).max * 3
  end

  it "writes the structured append header with the position, total and parity" do
    lines = (1..200).map { |i| line("201,#{i},1,1,2,612170709,ノルバスク錠２．５ｍｇ,4,1,錠") }
    symbols = described_class.new(lines)
    chunks = symbols.chunks
    parity = lines.join.each_byte.reduce(0, :^)

    segment = described_class::StructuredAppendSegment.new(data: chunks[1], position: 1, total: chunks.size, parity: parity)
    buffer = RQRCodeCore::QRBitBuffer.new(10)
    segment.writer.write(buffer)
    bits = buffer.buffer.map { |b| format("%08b", b) }.join
    expect(bits[0, 4]).to eq("0011")
    expect(bits[4, 4].to_i(2)).to eq(1)
    expect(bits[8, 4].to_i(2)).to eq(chunks.size - 1)
    expect(bits[12, 8].to_i(2)).to eq(parity)
    expect(bits[20, 4]).to eq("0100")
    expect(bits[24, 16].to_i(2)).to eq(chunks[1].bytesize)
    expect(segment.size(10)).to eq(4 + 16 + 8 * chunks[1].bytesize + 20)

    pngs = symbols.pngs
    expect(pngs.size).to eq(chunks.size)
    expect(pngs).to all(satisfy { |png| png?(png) })
  end

  it "raises when the prescription needs more than 16 symbols" do
    lines = (1..3000).map { |i| line("201,#{i},1,1,2,612170709,ノルバスク錠２．５ｍｇ,4,1,錠") }

    expect { described_class.new(lines).chunks }.to raise_error(described_class::TooLarge)
  end
end
