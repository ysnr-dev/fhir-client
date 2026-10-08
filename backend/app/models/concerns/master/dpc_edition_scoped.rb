module Master
  # DPC 電子点数表の行。版(edition、改定の開始日 YYYYMMDD)と、行ごとの有効期間
  # (valid_from / valid_to、YYYYMMDD の文字列。終了 99999999 は無期限)を持つ。
  module DpcEditionScoped
    extend ActiveSupport::Concern

    included do
      # 版の中で、基準日に有効な行。
      scope :in_edition, lambda { |edition, date = nil|
        scope = where(edition: edition)
        next scope if date.nil?

        day = Master::DpcEdition.day_string(date)
        scope.where("valid_from IS NULL OR valid_from = '' OR valid_from <= ?", day)
             .where("valid_to IS NULL OR valid_to = '' OR valid_to >= ?", day)
      }
    end
  end
end
