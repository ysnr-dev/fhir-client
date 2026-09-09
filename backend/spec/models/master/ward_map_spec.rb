require "rails_helper"

RSpec.describe Master::WardMap do
  def layout(objects: [], canvas: { "width" => 60, "height" => 40 }, **overrides)
    { "schema_version" => 1, "canvas" => canvas, "grid_size" => 20, "objects" => objects }.merge(overrides)
  end

  def fixture(**overrides)
    { "id" => "f1", "type" => "fixture", "kind" => "nurse_station", "x" => 0, "y" => 0, "w" => 8, "h" => 4,
      "rotation" => 0 }.merge(overrides)
  end

  def room(**overrides)
    { "id" => "r1", "type" => "room", "location_id" => "room-1", "x" => 10, "y" => 0, "w" => 8, "h" => 7 }.merge(overrides)
  end

  def bed(**overrides)
    { "id" => "b1", "type" => "bed", "location_id" => "bed-1", "room_id" => "room-1", "x" => 11, "y" => 1,
      "w" => 6, "h" => 5, "rotation" => 0 }.merge(overrides)
  end

  def build(**attrs)
    described_class.new({ ward_location_id: "ward-1", ward_name: "東3階病棟", layout: layout }.merge(attrs))
  end

  def error_messages(record)
    record.valid?
    record.errors[:layout]
  end

  it "既定のレイアウトで有効" do
    expect(build).to be_valid
    expect(build(layout: {})).to be_valid
  end

  it "設備・病室・ベッドを置いたレイアウトで有効" do
    expect(build(layout: layout(objects: [fixture, room, bed]))).to be_valid
  end

  it "同じ病棟のマップは 1 行だけ" do
    build.save!

    expect(build).not_to be_valid
  end

  it "layout_with_defaults は欠けたキーを既定値で埋める" do
    expect(build(layout: { "grid_size" => 24 }).layout_with_defaults).to eq(
      described_class::DEFAULT_LAYOUT.merge("grid_size" => 24),
    )
  end

  it "schema_version が違うと弾く" do
    expect(error_messages(build(layout: layout(schema_version: 2)))).to include(/schema_version/)
  end

  it "対象外の項目を弾く" do
    expect(error_messages(build(layout: layout(background: "x")))).to include(/対象外/)
    expect(error_messages(build(layout: layout(objects: [fixture("foo" => 1)])))).to include(/対象外/)
  end

  it "キャンバスの大きさの範囲を守る" do
    expect(error_messages(build(layout: layout(canvas: { "width" => 5, "height" => 40 })))).to include(/canvas.width/)
    expect(error_messages(build(layout: layout(canvas: { "width" => 60, "height" => 401 })))).to include(/canvas.height/)
    expect(error_messages(build(layout: layout(canvas: { "width" => "60", "height" => 40 })))).to include(/canvas.width/)
  end

  it "grid_size の範囲を守る" do
    expect(error_messages(build(layout: layout(grid_size: 8)))).to include(/grid_size/)
  end

  it "objects が配列でないと弾く" do
    expect(error_messages(build(layout: layout(objects: {})))).to include(/配列/)
  end

  it "id の重複を弾く" do
    expect(error_messages(build(layout: layout(objects: [fixture, fixture("x" => 20)])))).to include(/id が重複/)
  end

  it "id 無しを弾く" do
    expect(error_messages(build(layout: layout(objects: [fixture("id" => "")])))).to include(/id は必須/)
  end

  it "キャンバスの外に出た object を弾く" do
    expect(error_messages(build(layout: layout(objects: [fixture("x" => 55)])))).to include(/外に出て/)
    expect(error_messages(build(layout: layout(objects: [fixture("y" => -1)])))).to include(/0 以上/)
    expect(error_messages(build(layout: layout(objects: [fixture("w" => 0)])))).to include(/1 以上/)
    expect(error_messages(build(layout: layout(objects: [fixture("x" => 1.5)])))).to include(/整数/)
  end

  it "未知の type を弾く" do
    expect(error_messages(build(layout: layout(objects: [fixture("type" => "door")])))).to include(/type/)
  end

  it "設備の kind・rotation・color・label を検証する" do
    expect(error_messages(build(layout: layout(objects: [fixture("kind" => "pool")])))).to include(/kind/)
    expect(error_messages(build(layout: layout(objects: [fixture("rotation" => 45)])))).to include(/rotation/)
    expect(error_messages(build(layout: layout(objects: [fixture("color" => "red")])))).to include(/color/)
    expect(error_messages(build(layout: layout(objects: [fixture("label" => "あ" * 101)])))).to include(/label/)
    expect(build(layout: layout(objects: [fixture("color" => "#A1b2C3", "label" => "NS")]))).to be_valid
  end

  it "病室の location_id の重複を弾く(ベッドとは別に数える)" do
    expect(error_messages(build(layout: layout(objects: [room, room("id" => "r2", "x" => 20)])))).to include(/location_id が重複/)
    expect(build(layout: layout(objects: [room, bed("location_id" => "room-1")]))).to be_valid
  end

  it "ベッドの room_id と location_id は必須" do
    expect(error_messages(build(layout: layout(objects: [bed("room_id" => nil)])))).to include(/room_id/)
    expect(error_messages(build(layout: layout(objects: [bed("location_id" => "")])))).to include(/location_id は必須/)
  end

  it "objects の件数上限を守る" do
    many = Array.new(described_class::MAX_OBJECTS + 1) { |i| fixture("id" => "f#{i}", "w" => 1, "h" => 1) }
    expect(error_messages(build(layout: layout(objects: many)))).to include(/件まで/)
  end
end
