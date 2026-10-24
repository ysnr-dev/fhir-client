# 様式テンプレート(DocumentTemplate kind=form)のページ画像。ブラウザで PDF / 画像を
# ラスタライズした PNG / JPEG を 1 ページ 1 行で持つ。
#
# width_px / height_px はフィールド座標の基準(layout の x/y/w/h はこの px)。
# width_pt / height_pt は PDF にしたときのページ寸法で、描画時は pt/px の比で換算する。
class DocumentTemplatePage < ApplicationRecord
  CONTENT_TYPES = %w[image/png image/jpeg].freeze
  SIGNATURES = {
    "image/png" => "\x89PNG\r\n\x1a\n".b,
    "image/jpeg" => "\xFF\xD8\xFF".b
  }.freeze
  DATA_MAX_BYTESIZE = 1.5.megabytes
  PX_RANGE = (200..4000)
  PT_RANGE = (72..2000)

  belongs_to :document_template

  before_validation :assign_byte_size

  validates :page_number, numericality: { only_integer: true, greater_than_or_equal_to: 1 }
  validates :content_type, inclusion: { in: CONTENT_TYPES, message: "は PNG または JPEG にしてください" }
  validates :data, presence: true
  validates :width_px, :height_px, numericality: { only_integer: true, in: PX_RANGE }
  validates :width_pt, :height_pt, numericality: { in: PT_RANGE }
  validate :data_shape

  scope :ordered, -> { order(:page_number) }
  scope :without_data, -> { select(column_names - [ "data" ]) }

  private

  def assign_byte_size
    self.byte_size = data.to_s.bytesize if has_attribute?(:data)
  end

  def data_shape
    return if data.blank? || !CONTENT_TYPES.include?(content_type)

    errors.add(:data, "が #{content_type} の画像ではありません") unless data.b.start_with?(SIGNATURES[content_type])
    if data.bytesize > DATA_MAX_BYTESIZE
      errors.add(:data, "は 1 ページ #{(DATA_MAX_BYTESIZE / 1.megabyte.to_f).round(1)}MB 以下にしてください")
    end
  end
end
