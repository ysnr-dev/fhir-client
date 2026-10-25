# 文書テンプレート。FHIR のリソースではなく本アプリ固有のマスタ(docs/document-template-design.md)。
#
# kind は 2 種類。
#   office: Word / Excel の様式ファイル。プレースホルダー入りの本体(data)を預かって返すだけで、
#           カルテの値の差し込みはブラウザ側で行う。
#   form:   PDF / 画像の様式。ページ画像(document_template_pages)の上に置いたフィールドの配置を
#           layout に持ち、回答は自動生成した Questionnaire(questionnaire_url|version)への
#           QuestionnaireResponse として上流に保存する。表示用 PDF は Reports::DocumentFormRenderer。
#
# どのテンプレートから作った文書かは、上流の DocumentReference.type に
# system: http://fhir-client.local/CodeSystem/document-template の code として書く。
#
# layout(form)の形。座標・大きさはページ画像の px(整数)、font_size は pt。
#   { "schema_version": 1,
#     "fields": [
#       { "id": "f_...", "type": "text", "label": "患者氏名", "page": 1,
#         "x": 120, "y": 240, "w": 300, "h": 36, "font_size": 10.5, "align": "left", "required": false,
#         "mask": true,                             # 枠内を白で塗って雛形の印字を隠す
#         "options": ["男", "女"],                  # select のみ
#         "initial_expression": "%patientName",     # text / textarea / date
#         "transfer_kinds": ["prescription"],       # text / textarea
#         "date_format": "slash" } ] }              # date のみ
class DocumentTemplate < ApplicationRecord
  NAME_MAX_LENGTH = 100
  KINDS = %w[office form].freeze
  # 差し込み後のファイルを患者ファイル(1 件 7MB まで)として保存できるよう、余白を残す。
  DATA_MAX_BYTESIZE = 5.megabytes
  CONTENT_TYPES = {
    ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }.freeze
  ZIP_SIGNATURE = "PK\x03\x04".b.freeze

  # form の元ファイルの種類(表示用。本体はページ画像に置き換えて持つ)。
  FORM_SOURCE_CONTENT_TYPES = %w[application/pdf image/png image/jpeg].freeze
  MAX_PAGES = 10
  # 合成した PDF がページ画像の合計とほぼ同じ大きさになるので、患者ファイルの 7MB に収まる上限にする。
  PAGES_TOTAL_MAX_BYTESIZE = 5.megabytes

  SCHEMA_VERSION = 1
  LAYOUT_KEYS = %w[schema_version fields].freeze
  FIELD_TYPES = %w[text textarea select checkbox date].freeze
  ALIGNS = %w[left center right].freeze
  DATE_FORMATS = %w[slash iso wareki].freeze
  TRANSFER_KINDS = %w[prescription injection order condition lab].freeze
  FIELD_BASE_KEYS = %w[id type label page x y w h font_size align required mask].freeze
  FIELD_EXTRA_KEYS = {
    "text" => %w[initial_expression transfer_kinds],
    "textarea" => %w[initial_expression transfer_kinds],
    "select" => %w[options],
    "checkbox" => [],
    "date" => %w[initial_expression date_format]
  }.freeze
  MAX_FIELDS = 300
  MAX_LABEL_LENGTH = 100
  MAX_OPTIONS = 50
  MAX_OPTION_LENGTH = 100
  MAX_EXPRESSION_LENGTH = 500
  FONT_SIZE_RANGE = (6..72)

  belongs_to :file_category, optional: true
  has_many :pages, class_name: "DocumentTemplatePage", dependent: :destroy, autosave: true

  before_validation :assign_code
  before_validation :assign_file_attributes

  validates :code, presence: true, uniqueness: true
  validates :kind, inclusion: { in: KINDS }
  validates :name, presence: true, uniqueness: true, length: { maximum: NAME_MAX_LENGTH }
  validates :file_name, presence: true
  validates :display_order, numericality: { only_integer: true }
  validates :data, presence: true, if: :office?
  validate :file_must_be_office_document, if: :office?
  validate :form_shape, if: :form?

  scope :ordered, -> { order(:display_order, :id) }
  # 一覧では本体(数 MB)を読み込まない。
  scope :without_data, -> { select(column_names - [ "data" ]) }

  def office?
    kind == "office"
  end

  def form?
    kind == "form"
  end

  def extension
    File.extname(file_name.to_s).downcase
  end

  # 検証済みの layout のフィールド(form 以外は空)。
  def fields
    return [] unless form? && layout.is_a?(Hash)

    layout["fields"].is_a?(Array) ? layout["fields"] : []
  end

  private

  # code は運用者に入力させず採番する(表示名だけを管理すればよくする)。
  # form はフロントが Questionnaire の url に使うため先に採番して送ってくる。
  def assign_code
    self.code = SecureRandom.uuid if code.blank?
  end

  # 種類とサイズは送られてきた値を信用せず、ファイル名と本体から決める。
  def assign_file_attributes
    if office?
      return unless has_attribute?(:data)

      self.content_type = CONTENT_TYPES[extension].to_s
      self.byte_size = data.to_s.bytesize
    elsif form?
      self.data = nil if has_attribute?(:data)
      self.byte_size = live_pages.sum { |page| page.data.to_s.bytesize }
    end
  end

  def file_must_be_office_document
    return unless has_attribute?(:data)
    return if file_name.blank? || data.blank?

    unless CONTENT_TYPES.key?(extension)
      errors.add(:file_name, "は .docx または .xlsx のファイルを指定してください")
      return
    end
    errors.add(:data, "は Word / Excel のファイルではありません") unless data.b.start_with?(ZIP_SIGNATURE)
    if data.bytesize > DATA_MAX_BYTESIZE
      errors.add(:data, "は #{DATA_MAX_BYTESIZE / 1.megabyte}MB 以下にしてください")
    end
  end

  # ---- form ----

  def form_shape
    unless FORM_SOURCE_CONTENT_TYPES.include?(content_type)
      errors.add(:content_type, "は PDF / PNG / JPEG のいずれかにしてください")
    end
    errors.add(:questionnaire_url, "を入力してください") if questionnaire_url.blank?
    errors.add(:questionnaire_version, "を入力してください") if questionnaire_version.blank?
    validate_pages
    layout_shape
  end

  # 差し替え中(mark_for_destruction 済み)の旧ページを除いた、保存後に残るページ。
  def live_pages
    pages.reject(&:marked_for_destruction?)
  end

  def validate_pages
    current = live_pages
    if current.empty?
      errors.add(:pages, "を 1 ページ以上登録してください")
      return
    end
    errors.add(:pages, "は #{MAX_PAGES} ページまでです") if current.size > MAX_PAGES
    numbers = current.map(&:page_number)
    unless numbers.sort == (1..current.size).to_a
      errors.add(:pages, "の page_number は 1 から連番にしてください")
    end
    total = current.sum { |page| page.data.to_s.bytesize }
    if total > PAGES_TOTAL_MAX_BYTESIZE
      errors.add(:pages, "は合計 #{PAGES_TOTAL_MAX_BYTESIZE / 1.megabyte}MB 以下にしてください")
    end
  end

  def layout_shape
    return errors.add(:layout, "を指定してください") if layout.nil?
    return errors.add(:layout, "は連想配列で指定してください") unless layout.is_a?(Hash)

    unknown = layout.keys - LAYOUT_KEYS
    errors.add(:layout, "に対象外の項目があります(#{unknown.join(', ')})") if unknown.any?
    unless layout["schema_version"] == SCHEMA_VERSION
      errors.add(:layout, "の schema_version は #{SCHEMA_VERSION} のみ使えます")
    end

    fields = layout["fields"]
    return errors.add(:layout, "の fields は配列で指定してください") unless fields.is_a?(Array)
    return errors.add(:layout, "の fields は #{MAX_FIELDS} 件までです") if fields.size > MAX_FIELDS

    pages_by_number = live_pages.index_by(&:page_number)
    ids = Set.new
    fields.each_with_index { |field, index| validate_field(field, index, pages_by_number, ids) }
  end

  def validate_field(field, index, pages_by_number, ids)
    label = "の fields[#{index}]"
    return errors.add(:layout, "#{label} は連想配列で指定してください") unless field.is_a?(Hash)

    type = field["type"]
    unless FIELD_TYPES.include?(type)
      return errors.add(:layout, "#{label} の type は #{FIELD_TYPES.join(' / ')} のいずれかで指定してください")
    end

    unknown = field.keys - FIELD_BASE_KEYS - FIELD_EXTRA_KEYS[type]
    errors.add(:layout, "#{label} に対象外の項目があります(#{unknown.join(', ')})") if unknown.any?

    id = field["id"]
    if !id.is_a?(String) || id.blank?
      errors.add(:layout, "#{label} の id を指定してください")
    elsif !ids.add?(id)
      errors.add(:layout, "#{label} の id が重複しています(#{id})")
    end

    unless field["label"].is_a?(String) && field["label"].length <= MAX_LABEL_LENGTH
      errors.add(:layout, "#{label} の label は #{MAX_LABEL_LENGTH} 文字以内の文字列で指定してください")
    end

    page = pages_by_number[field["page"]]
    errors.add(:layout, "#{label} の page が存在しません") unless page
    validate_rect(field, label, page)

    font_size = field["font_size"]
    unless font_size.is_a?(Numeric) && FONT_SIZE_RANGE.cover?(font_size)
      errors.add(:layout, "#{label} の font_size は #{FONT_SIZE_RANGE.min}〜#{FONT_SIZE_RANGE.max} で指定してください")
    end
    unless field["align"].nil? || ALIGNS.include?(field["align"])
      errors.add(:layout, "#{label} の align は #{ALIGNS.join(' / ')} のいずれかで指定してください")
    end
    %w[required mask].each do |key|
      next if field[key].nil? || [ true, false ].include?(field[key])

      errors.add(:layout, "#{label} の #{key} は真偽値で指定してください")
    end

    validate_field_extras(field, type, label)
  end

  def validate_rect(field, label, page)
    %w[x y w h].each do |key|
      value = field[key]
      next if value.is_a?(Integer) && value >= (key == "w" || key == "h" ? 1 : 0)

      errors.add(:layout, "#{label} の #{key} は #{key == 'w' || key == 'h' ? 1 : 0} 以上の整数で指定してください")
    end
    return unless page && %w[x y w h].all? { |key| field[key].is_a?(Integer) }

    if field["x"] + field["w"] > page.width_px || field["y"] + field["h"] > page.height_px
      errors.add(:layout, "#{label} がページの外にはみ出しています")
    end
  end

  def validate_field_extras(field, type, label)
    if type == "select"
      options = field["options"]
      valid = options.is_a?(Array) && options.size.between?(1, MAX_OPTIONS) &&
              options.all? { |o| o.is_a?(String) && o.present? && o.length <= MAX_OPTION_LENGTH } &&
              options.uniq.size == options.size
      errors.add(:layout, "#{label} の options は重複しない 1〜#{MAX_OPTIONS} 件の文字列で指定してください") unless valid
    end
    if field.key?("initial_expression")
      expression = field["initial_expression"]
      unless expression.is_a?(String) && expression.length <= MAX_EXPRESSION_LENGTH
        errors.add(:layout, "#{label} の initial_expression は #{MAX_EXPRESSION_LENGTH} 文字以内の文字列で指定してください")
      end
    end
    if field.key?("transfer_kinds")
      kinds = field["transfer_kinds"]
      unless kinds.is_a?(Array) && kinds.all? { |k| TRANSFER_KINDS.include?(k) } && kinds.uniq.size == kinds.size
        errors.add(:layout, "#{label} の transfer_kinds は #{TRANSFER_KINDS.join(' / ')} から重複なく指定してください")
      end
    end
    if field.key?("date_format") && !DATE_FORMATS.include?(field["date_format"])
      errors.add(:layout, "#{label} の date_format は #{DATE_FORMATS.join(' / ')} のいずれかで指定してください")
    end
  end
end
