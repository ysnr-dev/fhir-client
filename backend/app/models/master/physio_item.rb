module Master
  # 生理検査オーダー項目。医師がオーダー画面で選ぶ単位の検査項目で、
  # セットの構成は master_physio_set_items が持つ。
  # 検査種別はコードで master_physio_exam_types に緩く紐づく。
  # dataset_code は実施入力の初期明細(master_physio_datasets)。1項目1つで、
  # 同じデータセットを複数の項目から参照してよい。実施入力をしない項目
  # (requires_perform_input = false)は初期明細を持たない。
  #
  # 放射線の RadItem との違いは JJ1017 を持たないこと。要素コードの検証と
  # 32桁コードの組み立てが無いぶん素直になる。
  class PhysioItem < ApplicationRecord
    self.table_name = "master_physio_items"

    KINDS = %w[single set].freeze

    validates :item_code, presence: true, uniqueness: true
    validates :name, presence: true
    validates :kind, inclusion: { in: KINDS }
    validates :duration_minutes, numericality: { only_integer: true, greater_than: 0 },
                                 allow_nil: true
    validate :valid_period_is_ordered
    validate :solo_item_is_not_a_set_member
    validate :appointment_item_is_solo

    before_save :set_search_columns
    before_save :clear_dataset_without_perform_input
    before_save :clear_schedule_without_appointment

    def set?
      kind == "set"
    end

    private

    def valid_period_is_ordered
      return if valid_from.blank? || valid_to.blank? || valid_from <= valid_to

      errors.add(:valid_to, "は有効開始日以降の日付にしてください")
    end

    # セットの構成項目は、そのセットの他の検査と必ず同じオーダーに載る。単独に
    # してもオーダーを分けられないので、矛盾する組み合わせを保存させない
    # (逆向きの防止は PhysioSetItem 側にある)。
    def solo_item_is_not_a_set_member
      return if groupable || item_code.blank?
      return unless PhysioSetItem.exists?(member_item_code: item_code)

      # 画面にそのまま出る文なので、属性名が頭に付かない :base に載せる。
      errors.add(:base, "セットの構成項目になっているため単独オーダーにできません")
    end

    # 予約必須の項目は検査室の枠(予約)ごとにオーダーが立つので、必ず単独オーダーに
    # する。他の項目とまとめられると 1 オーダーに予約が複数ぶら下がってしまう。
    # 画面では予約必須を選ぶと単独に固定されるが、API から入る矛盾もここで落とす。
    def appointment_item_is_solo
      return unless requires_appointment && groupable

      errors.add(:base, "予約必須の項目は単独オーダーにしてください")
    end

    # 実施入力をしない項目は実施入力の初期明細も持たない。画面では選べないように
    # しているが、API から入っても矛盾した組み合わせが残らないようにここでも落とす。
    def clear_dataset_without_perform_input
      self.dataset_code = nil unless requires_perform_input
    end

    # 予約枠(FHIR Schedule)への紐づけは予約必須の項目だけが持つ(dataset と同じ扱い)。
    def clear_schedule_without_appointment
      self.appointment_schedule_id = nil unless requires_appointment
    end

    def set_search_columns
      self.search_name = SearchNormalizer.normalize(name)
      self.search_short_name = SearchNormalizer.normalize(short_name)
      self.search_kana = SearchNormalizer.normalize(name_kana)
    end
  end
end
