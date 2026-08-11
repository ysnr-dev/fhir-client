module Master
  # シェーマ台紙。画像本体(image)と一覧用縮小版(thumbnail)を dataURL 文字列で
  # DB に持つ(フロントで長辺1600px/160pxに正規化してから登録される)。
  class Schema < ApplicationRecord
    self.table_name = "master_schemas"

    # フロントの normalizeImageFile が出力する形式のみ受け付ける。
    DATA_URL_FORMAT = %r{\Adata:image/(png|jpeg);base64,}
    # 正規化済み画像の上限(1600px PNG でも収まる余裕を持たせたバイト数)。
    MAX_IMAGE_BYTES = 8.megabytes
    MAX_THUMBNAIL_BYTES = 100.kilobytes

    validates :name, presence: true
    validates :image, presence: true, format: { with: DATA_URL_FORMAT, message: "はPNG/JPEGのdataURL形式で指定してください" }
    validates :thumbnail, presence: true, format: { with: DATA_URL_FORMAT, message: "はPNG/JPEGのdataURL形式で指定してください" }
    validate :image_size_within_limit

    private

    def image_size_within_limit
      errors.add(:image, "が大きすぎます") if image.present? && image.bytesize > MAX_IMAGE_BYTES
      errors.add(:thumbnail, "が大きすぎます") if thumbnail.present? && thumbnail.bytesize > MAX_THUMBNAIL_BYTES
    end
  end
end
