module Master
  # 病棟マップのレイアウト(1 病棟 1 行)。
  #
  # layout は jsonb で、形は次のとおり(座標・大きさはすべてグリッドのマス数、整数)。
  #
  #   { "schema_version": 1,
  #     "canvas": { "width": 60, "height": 40 },   # マス数
  #     "grid_size": 20,                            # 1 マスの px
  #     "objects": [
  #       { "id": "...", "type": "fixture", "kind": "nurse_station", "x": 0, "y": 0, "w": 8, "h": 4,
  #         "rotation": 0, "label": "NS", "color": "#aabbcc" },
  #       { "id": "...", "type": "room", "location_id": "<病室 Location.id>", "x": .., "y": .., "w": .., "h": .. },
  #       { "id": "...", "type": "bed",  "location_id": "<ベッド Location.id>", "room_id": "<病室 Location.id>",
  #         "x": .., "y": .., "w": 6, "h": 5, "rotation": 0 } ] }
  #
  # 病室・ベッドの名前は持たない(表示時に Location から出す)。同じ Location を
  # 2 か所に描くことはできない(location_id は type ごとに一意)。
  # ベッドの大きさは frontend が固定値に矯正するので、ここでは w/h ≥ 1 だけ見る
  # (定数を二重に持たない)。
  class WardMap < ApplicationRecord
    self.table_name = "master_ward_maps"

    SCHEMA_VERSION = 1
    LAYOUT_KEYS = %w[schema_version canvas grid_size objects].freeze
    OBJECT_TYPES = %w[fixture room bed].freeze
    FIXTURE_KINDS = %w[nurse_station toilet bath stairs elevator corridor wall door
                       treatment dayroom label area].freeze
    ROTATIONS = [0, 90, 180, 270].freeze
    CANVAS_RANGE = (10..400)
    GRID_SIZE_RANGE = (12..48)
    MAX_OBJECTS = 2000
    MAX_LABEL_LENGTH = 100
    COLOR_PATTERN = /\A#[0-9a-fA-F]{6}\z/
    BASE_KEYS = %w[id type x y w h].freeze
    EXTRA_KEYS = {
      "fixture" => %w[kind label rotation color],
      "room" => %w[location_id],
      "bed" => %w[location_id room_id rotation]
    }.freeze

    DEFAULT_LAYOUT = {
      "schema_version" => SCHEMA_VERSION,
      "canvas" => { "width" => 60, "height" => 40 },
      "grid_size" => 20,
      "objects" => []
    }.freeze

    validates :ward_location_id, presence: true, uniqueness: true
    validate :layout_shape

    # 欠けたキーを既定値で埋めたレイアウト。読み出しは常にこちらを使う。
    def layout_with_defaults
      stored = layout.is_a?(Hash) ? layout : {}
      DEFAULT_LAYOUT.merge(stored.slice(*LAYOUT_KEYS))
    end

    private

    def layout_shape
      return if layout.blank?
      return errors.add(:layout, "は連想配列で指定してください") unless layout.is_a?(Hash)

      unknown = layout.keys - LAYOUT_KEYS
      errors.add(:layout, "に対象外の項目があります(#{unknown.join(', ')})") if unknown.any?

      unless layout["schema_version"].nil? || layout["schema_version"] == SCHEMA_VERSION
        errors.add(:layout, "の schema_version は #{SCHEMA_VERSION} のみ使えます")
      end

      canvas = validate_canvas(layout["canvas"])
      validate_grid_size(layout["grid_size"])
      validate_objects(layout["objects"], canvas)
    end

    # 検証済みの canvas(幅・高さ)を返す。壊れていれば nil(座標の範囲チェックは飛ばす)。
    def validate_canvas(canvas)
      return DEFAULT_LAYOUT["canvas"] if canvas.nil?
      unless canvas.is_a?(Hash)
        errors.add(:layout, "の canvas は連想配列で指定してください")
        return nil
      end

      ok = %w[width height].all? do |key|
        value = canvas[key]
        valid = value.is_a?(Integer) && CANVAS_RANGE.cover?(value)
        errors.add(:layout, "の canvas.#{key} は #{CANVAS_RANGE.min}〜#{CANVAS_RANGE.max} の整数で指定してください") unless valid
        valid
      end
      ok ? canvas : nil
    end

    def validate_grid_size(grid_size)
      return if grid_size.nil?
      return if grid_size.is_a?(Integer) && GRID_SIZE_RANGE.cover?(grid_size)

      errors.add(:layout, "の grid_size は #{GRID_SIZE_RANGE.min}〜#{GRID_SIZE_RANGE.max} の整数で指定してください")
    end

    def validate_objects(objects, canvas)
      return if objects.nil?
      return errors.add(:layout, "の objects は配列で指定してください") unless objects.is_a?(Array)
      return errors.add(:layout, "の objects は #{MAX_OBJECTS} 件までです") if objects.size > MAX_OBJECTS

      ids = Set.new
      locations = Hash.new { |h, k| h[k] = Set.new }
      objects.each_with_index do |object, index|
        validate_object(object, index, canvas, ids, locations)
      end
    end

    def validate_object(object, index, canvas, ids, locations)
      label = "の objects[#{index}]"
      return errors.add(:layout, "#{label} は連想配列で指定してください") unless object.is_a?(Hash)

      type = object["type"]
      return errors.add(:layout, "#{label} の type は #{OBJECT_TYPES.join(' / ')} のいずれかで指定してください") unless OBJECT_TYPES.include?(type)

      unknown = object.keys - BASE_KEYS - EXTRA_KEYS[type]
      errors.add(:layout, "#{label} に対象外の項目があります(#{unknown.join(', ')})") if unknown.any?

      id = object["id"]
      if id.is_a?(String) && id.present?
        errors.add(:layout, "#{label} の id が重複しています") unless ids.add?(id)
      else
        errors.add(:layout, "#{label} の id は必須です")
      end

      validate_bounds(object, label, canvas)

      case type
      when "fixture" then validate_fixture(object, label)
      when "room" then validate_location_ref(object, label, type, locations)
      when "bed"
        validate_location_ref(object, label, type, locations)
        errors.add(:layout, "#{label} の room_id は必須です") unless object["room_id"].is_a?(String) && object["room_id"].present?
        validate_rotation(object, label)
      end
    end

    def validate_bounds(object, label, canvas)
      %w[x y].each do |key|
        value = object[key]
        errors.add(:layout, "#{label} の #{key} は 0 以上の整数で指定してください") unless value.is_a?(Integer) && value >= 0
      end
      %w[w h].each do |key|
        value = object[key]
        errors.add(:layout, "#{label} の #{key} は 1 以上の整数で指定してください") unless value.is_a?(Integer) && value >= 1
      end
      return unless canvas && %w[x y w h].all? { |key| object[key].is_a?(Integer) }

      inside = object["x"] + object["w"] <= canvas["width"] && object["y"] + object["h"] <= canvas["height"]
      errors.add(:layout, "#{label} がキャンバスの外に出ています") unless inside
    end

    def validate_fixture(object, label)
      errors.add(:layout, "#{label} の kind が対象外です") unless FIXTURE_KINDS.include?(object["kind"])
      validate_rotation(object, label)
      if object.key?("label") && !(object["label"].is_a?(String) && object["label"].length <= MAX_LABEL_LENGTH)
        errors.add(:layout, "#{label} の label は #{MAX_LABEL_LENGTH} 文字以内で指定してください")
      end
      return unless object.key?("color")
      return if object["color"].is_a?(String) && object["color"].match?(COLOR_PATTERN)

      errors.add(:layout, "#{label} の color は #rrggbb で指定してください")
    end

    def validate_rotation(object, label)
      return unless object.key?("rotation")
      return if ROTATIONS.include?(object["rotation"])

      errors.add(:layout, "#{label} の rotation は #{ROTATIONS.join(' / ')} のいずれかで指定してください")
    end

    def validate_location_ref(object, label, type, locations)
      location_id = object["location_id"]
      unless location_id.is_a?(String) && location_id.present?
        return errors.add(:layout, "#{label} の location_id は必須です")
      end
      return if locations[type].add?(location_id)

      errors.add(:layout, "#{label} の location_id が重複しています(同じ場所を 2 か所に置けません)")
    end
  end
end
