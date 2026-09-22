# 「自院」がどの Organization かと、施設ごとの業務設定を持つ単一行モデル。
#
# 本アプリはマルチテナントではなく、スタッフ・診療科・診察室は自院のものしか
# 登録しない。一方で診療情報提供書の送付先候補として他院の医療機関・医師も
# Organization / Practitioner として登録するため、「どれが自院か」を宣言する
# 場所が要る。ここがその唯一の宣言で、backend(処方箋 PDF の医療機関欄)と
# frontend(各マスタの所属既定値・帳票の自院欄)が同じ値を参照する。
#
# 接続設定(FhirConnectionSettings)とは分けている。あちらは「どのサーバーに
# 繋ぐか」というインフラ設定で秘密情報を持ち管理者しか読めないが、こちらは
# 業務設定でログイン済みユーザー全員が読む。
#
# ## 設定項目の持ち方
#
# 自院の Organization 以外の設定は、すべて settings(jsonb)1 列にまとめて入れる。
# backend はこれらを検索にも集計にも使わず(読むのは frontend だけ)、列に分けても
# 索引も WHERE も使わないため。**項目を足すときに書くのは下の SETTINGS だけ**で、
# 検証・既定値の穴埋め・読み書きのメソッド・管理 API の受け取りと応答は
# FacilitySettings::Schema が項目表から回す(migration も要らない)。
#
# どの設定も「登録時の初期値」か「表示時の判定」のどちらかで、**登録済みの
# リソースは動かさない**(オーダーや Task には値が焼き付いている)。
class FacilitySettings < ApplicationRecord
  # 単一行の強制: ガード列は常に 0。一意インデックス(migration)と合わせて 2 行目を弾く。
  attribute :singleton_guard, :integer, default: 0
  validates :singleton_guard, inclusion: { in: [0] }, uniqueness: true

  TIME_PATTERN = /\A([01]\d|2[0-3]):[0-5]\d\z/
  # MEDIS の管理番号は 8 桁の数字。
  MANAGE_NO_PATTERN = /\A\d{8}\z/

  MANAGE_NO = { pattern: MANAGE_NO_PATTERN, label: "管理番号" }.freeze
  MINUTES = { integer: { min: 0, unit: "分" } }.freeze
  DAYS = { integer: { min: 0, unit: "日数" } }.freeze

  # 看護指示の既定時刻。"daily" は「1日N回」の N ごとの時刻、"interval_start" は
  # 「N時間毎」の起点。指示を登録するときの初期値に使うだけで、登録済みの指示には
  # 時刻が焼き付いている(ここを変えても過去の指示は動かない)。
  DEFAULT_NURSING_SCHEDULE = {
    "daily" => {
      "1" => ["10:00"],
      "2" => ["10:00", "18:00"],
      "3" => ["09:00", "14:00", "20:00"],
      "4" => ["06:00", "10:00", "14:00", "18:00"]
    },
    "interval_start" => "06:00"
  }.freeze

  # 食事の提供時刻。退院・外出泊の日時から「その時刻までに出た最後の食事」「その時刻以降の
  # 最初の食事」を決めるのに使う。食事オーダーの occurrenceDateTime に焼く 08/12/18 は
  # SS-MIX2 のコードで、ここの時刻とは別物(この設定を変えてもオーダーの時刻は動かない)。
  DEFAULT_MEAL_SCHEDULE = {
    "breakfast" => "08:00",
    "lunch" => "12:00",
    "dinner" => "18:00"
  }.freeze

  # 経過表でバイタルを異常値として強調するしきい値。キーは LOINC コード、値は下限(low)と
  # 上限(high)で、下限以下を L・上限以上を H とする。どちらかを省けばその側は判定しない。
  # 判定は表示時に行う(Observation.interpretation には書かない)ので、ここを変えれば
  # 過去の測定にもそのまま効く。
  DEFAULT_VITAL_THRESHOLDS = {
    "8480-6" => { "low" => 90, "high" => 180 }, # 収縮期血圧
    "8462-4" => { "high" => 110 },              # 拡張期血圧
    "8310-5" => { "high" => 37.5 },             # 体温
    "8867-4" => { "low" => 50, "high" => 100 }, # 脈拍
    "2708-6" => { "low" => 90 },                # SpO2
    "9279-1" => { "low" => 10, "high" => 25 }   # 呼吸数
  }.freeze

  # 内服の与薬の予定時刻。処方は「1 日 3 回・食後」までしか持たないので、食事の時刻
  # (meal_schedule)からのずらしと、就寝前・起床時の時刻を持つ。経過表の内服欄が
  # 用法コードを展開して予定の印を置くのに使う(表示時に計算するので、ここを変えれば
  # 過去の処方の予定にも効く)。
  DEFAULT_MEDICATION_SCHEDULE = {
    "before_meal_minutes" => 30,
    "after_meal_minutes" => 30,
    "bedtime" => "21:00",
    "wake_time" => "06:00"
  }.freeze

  # 経過表の水分出納(In/Out)に数える看護観察の項目(MEDIS の管理番号)。
  # 何を数えるかは施設の運用で違うので既定は空にし、施設設定で選ばせる
  # (尿量だけで 29 件、ドレーン排液は 200 件超あり、汎用の既定値は作れない)。
  # 空のままだと経過表に欄が出ないので、代表的な項目は db:seed で入れる
  # (db/seed_data/water_balance_items.csv。選んである施設は上書きしない)。
  DEFAULT_WATER_BALANCE = { "in" => [], "out" => [] }.freeze
  WATER_BALANCE_KEYS = DEFAULT_WATER_BALANCE.keys.freeze

  # 文書作成の督促。退院時サマリーは退院日からこの日数を期限にして、退院の時点で
  # 主治医あての通知 Task を作る(期限は Task に焼き付くので、ここを変えても
  # 作成済みの通知は動かない)。
  DEFAULT_DOCUMENT_REMINDER = {
    "discharge_summary_days" => 14
  }.freeze

  # 処方区分の初期値。処方フォームを開いたときと、入外区分を選び直したときの値に使う。
  # 既定は空(「選択してください」のまま開く)。
  DEFAULT_PRESCRIPTION_CATEGORY = {
    "inpatient" => "",
    "outpatient" => ""
  }.freeze

  # 入外区分ごとに選べる処方区分のコード。表示名は画面側(frontend の CATEGORY_OPTIONS)が
  # 持ち、こちらは初期値として妥当なコードかを見るためだけに並べる。
  PRESCRIPTION_CATEGORY_CODES = {
    "inpatient" => %w[regular continuous temporary discharge emergency],
    "outpatient" => %w[external internal]
  }.freeze

  # 他科依頼の依頼目的テンプレートの既定(依頼先の診療科ごと)。キーは診療科の
  # Organization.id、値はテンプレート(Questionnaire)の canonical。依頼先を選んだときに
  # テンプレート選択の初期値に使う。診療科は上流のリソースなので、キーは環境ごとに違う。
  DEFAULT_CONSULT_DEFAULT_TEMPLATES = {}.freeze
  CANONICAL = { pattern: %r{\Ahttps?://\S+\z}, label: "テンプレートの canonical" }.freeze

  # 放射線治療の治療中の診察(週次レビュー)。最後の診察からこの日数を超えたコースを
  # 部門一覧で強調する。
  #
  # 既定の 7 日は診療報酬の外来放射線照射診療料(B001-2-8)に合わせてある —— 同点数は
  # 「7 日間に 1 回に限り算定」し、算定日に放射線治療医が診察することを要件にしている。
  # ただしこれは**外来の患者**の算定要件で、入院患者や施設ごとの運用まで縛るものでは
  # ないので設定で変えられるようにしている。
  DEFAULT_RADIOTHERAPY_REVIEW = {
    "interval_days" => 7
  }.freeze

  # 設定項目の表。ここに 1 項目足せば、検証・既定値・読み書き・管理 API がすべて付く。
  #
  #   default: 保存されていないときに返す値
  #   shape:   構造(節の書き方は FacilitySettings::Schema のコメント)
  #   check:   構造では書けない決まりごと(任意。エラー文言の配列を返す)
  SETTINGS = {
    "nursing_schedule" => {
      default: DEFAULT_NURSING_SCHEDULE,
      # 「1日N回」の N は施設が増やせるようにキーを縛らない。
      shape: { fields: { "daily" => { map: { list: :time }, keys: :any }, "interval_start" => :time } }
    },
    "meal_schedule" => {
      default: DEFAULT_MEAL_SCHEDULE,
      shape: { fields: DEFAULT_MEAL_SCHEDULE.keys.index_with(:time) }
    },
    "vital_thresholds" => {
      default: DEFAULT_VITAL_THRESHOLDS,
      shape: {
        map: { fields: { "low" => :number, "high" => :number } },
        keys: DEFAULT_VITAL_THRESHOLDS.keys
      },
      check: lambda { |value|
        (value.is_a?(Hash) ? value : {}).filter_map do |code, bounds|
          next unless bounds.is_a?(Hash)

          low = bounds["low"]
          high = bounds["high"]
          "#{code} は下限 < 上限にしてください" if low.is_a?(Numeric) && high.is_a?(Numeric) && low >= high
        end
      }
    },
    "water_balance" => {
      default: DEFAULT_WATER_BALANCE,
      shape: { fields: WATER_BALANCE_KEYS.index_with({ list: MANAGE_NO }) }
    },
    "medication_schedule" => {
      default: DEFAULT_MEDICATION_SCHEDULE,
      shape: {
        fields: {
          "before_meal_minutes" => MINUTES,
          "after_meal_minutes" => MINUTES,
          "bedtime" => :time,
          "wake_time" => :time
        }
      }
    },
    "document_reminder" => {
      default: DEFAULT_DOCUMENT_REMINDER,
      shape: { fields: { "discharge_summary_days" => DAYS } }
    },
    "prescription_category" => {
      default: DEFAULT_PRESCRIPTION_CATEGORY,
      shape: {
        fields: PRESCRIPTION_CATEGORY_CODES.transform_values { |codes| { enum: codes, blank: true } }
      }
    },
    "consult_default_templates" => {
      default: DEFAULT_CONSULT_DEFAULT_TEMPLATES,
      shape: { map: CANONICAL, keys: :any }
    },
    "radiotherapy_review" => {
      default: DEFAULT_RADIOTHERAPY_REVIEW,
      shape: { fields: { "interval_days" => DAYS } },
      check: lambda { |value|
        days = value.is_a?(Hash) ? value["interval_days"] : nil
        ["診察の間隔は 1 日以上にしてください"] if days.is_a?(Integer) && days < 1
      }
    }
  }.freeze

  validate :settings_shape

  # 項目ごとの読み書き。保存値そのもの(nursing_schedule)、既定値で埋めた読み出し用
  # (nursing_schedule_with_defaults)、単一行を引く近道(FacilitySettings.nursing_schedule)。
  SETTINGS.each do |key, spec|
    define_method(key) { stored_settings[key] }

    define_method("#{key}=") { |value| self.settings = stored_settings.merge(key => value) }

    define_method("#{key}_with_defaults") { Schema.fill(spec[:shape], spec[:default], stored_settings[key]) }

    singleton_class.define_method(key) { current.public_send("#{key}_with_defaults") }
  end

  # 自院の Organization.id。未設定なら nil(呼び出し側は推測に倒す)。
  def self_organization_id
    self_organization_fhir_id.presence
  end

  # 全項目を既定値で埋めたもの。API の応答はこれをそのまま返す。
  def settings_with_defaults
    SETTINGS.keys.index_with { |key| public_send("#{key}_with_defaults") }
  end

  # 管理 API から来た設定を重ねる。**渡された項目だけ**を差し替える(看護指示の既定時刻
  # だけを保存できるように)。文字列で来た数値はここで数値に寄せ、妥当性は検証に任せる。
  def apply_settings(incoming)
    merged = (incoming || {}).to_h do |key, value|
      spec = SETTINGS[key.to_s]
      [key.to_s, spec ? Schema.coerce(spec[:shape], value) : value]
    end
    self.settings = stored_settings.merge(merged)
  end

  class << self
    # 単一行を遅延生成して返す。
    def current
      first_or_create!
    end

    def self_organization_id
      current.self_organization_id
    end
  end

  private

  def stored_settings
    settings.is_a?(Hash) ? settings : {}
  end

  def settings_shape
    return errors.add(:settings, "は連想配列で指定してください") unless settings.is_a?(Hash)

    settings.each do |key, value|
      spec = SETTINGS[key.to_s]
      next errors.add(:settings, "#{key} は対象外の項目です") if spec.nil?

      messages = Schema.errors(spec[:shape], value) + Array(spec[:check]&.call(value))
      messages.each { |message| errors.add(key.to_sym, message) }
    end
  end
end
