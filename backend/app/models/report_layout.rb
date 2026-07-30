# 帳票レイアウト(.tlf)を Questionnaire の canonical(url|version)に紐付けて保持する。
# レイアウトは ThinReports Basic Editor で作成し、管理画面からアップロードする。
# QuestionnaireResponse の PDF 化時に canonical で引き当てて使う。
class ReportLayout < ApplicationRecord
  # tlf は JSON テキスト。実運用のレイアウトは数十KB程度なので余裕を持った上限。
  TLF_MAX_BYTESIZE = 2.megabytes
  MAPPING_MAX_BYTESIZE = 1.megabyte

  validates :name, presence: true
  validates :questionnaire_url, presence: true,
                                uniqueness: { scope: :questionnaire_version }
  validates :tlf, presence: true
  validate :tlf_must_be_valid_layout
  validate :mapping_must_be_valid

  # "url|version" (version 省略時は url のみ) からレイアウトを引く。
  # canonical の一意性はテンプレート保存時に検証済みなので、この引き当ては一意になる。
  def self.for_canonical(canonical)
    url, version = canonical.to_s.split("|", 2)
    return nil if url.blank?

    find_by(questionnaire_url: url, questionnaire_version: version.to_s)
  end

  def canonical
    questionnaire_version.blank? ? questionnaire_url : "#{questionnaire_url}|#{questionnaire_version}"
  end

  # Thinreports::Report はレイアウトをファイルパスでしか受け取れないため、
  # tlf を一時ファイルに書き出してパスを yield する。
  def with_tlf_file
    Tempfile.create(["report_layout", ".tlf"]) do |file|
      file.write(tlf)
      file.flush
      yield file.path
    end
  end

  # マッピング定義(Reports::LayoutMapping)。未設定なら nil を返し、
  # レンダラーは従来どおり ItemIdMapper の命名規約のみで対応する。
  def parsed_mapping
    Reports::LayoutMapping.parse(mapping)
  end

  private

  # 壊れた JSON を保存して PDF 生成時に初めて失敗する事態を防ぐ。
  def tlf_must_be_valid_layout
    return if tlf.blank?

    if tlf.bytesize > TLF_MAX_BYTESIZE
      errors.add(:tlf, "が大きすぎます(#{TLF_MAX_BYTESIZE / 1.megabyte}MB 以内)")
      return
    end

    parsed = JSON.parse(tlf)
    unless parsed.is_a?(Hash) && parsed.key?("items")
      errors.add(:tlf, "が ThinReports のレイアウトファイル(.tlf)ではありません")
    end
  rescue JSON::ParserError
    errors.add(:tlf, "が JSON として不正です")
  end

  # マッピングも tlf と同様、保存時に構造を検証して生成時の失敗を防ぐ。
  def mapping_must_be_valid
    return if mapping.blank?

    if mapping.bytesize > MAPPING_MAX_BYTESIZE
      errors.add(:mapping, "が大きすぎます(#{MAPPING_MAX_BYTESIZE / 1.megabyte}MB 以内)")
      return
    end

    Reports::LayoutMapping.validate(mapping).each { |message| errors.add(:mapping, message) }
  end
end
