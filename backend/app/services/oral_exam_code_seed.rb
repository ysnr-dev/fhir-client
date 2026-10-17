require "csv"

# 口腔診査のコード表(db/seed_data/oral_exam_codes.csv)の投入。seeds.rb と migration の両方から呼ぶ
# (本番は起動時に db:seed が走らないため)。同じ (item, code) の行は触らないので、何度呼んでも増えない。
class OralExamCodeSeed
  Result = Struct.new(:created, :kept)

  COLUMNS = %w[record item item_name code display tf_ref cs_name cs_oid note].freeze

  def self.load!(path = Rails.root.join("db/seed_data/oral_exam_codes.csv"))
    existing = Master::OralExamCode.pluck(:item, :code).to_set
    created = 0
    kept = 0
    CSV.foreach(path, headers: true) do |row|
      key = [row["item"], row["code"]]
      if existing.include?(key)
        kept += 1
        next
      end

      attrs = COLUMNS.to_h { |column| [column, row[column].presence] }
      Master::OralExamCode.create!(attrs.merge("display_order" => row["display_order"].presence&.to_i))
      existing << key
      created += 1
    end
    Result.new(created, kept)
  end
end
