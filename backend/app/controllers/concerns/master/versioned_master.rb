module Master
  # 承認で内容を凍結し、版を重ねて運用するマスタ(クリニカルパス・レジメン)の共通処理。
  # 本体と子を 1 リクエストで読み書きし、承認済・廃止は内容を凍結して直すときは複製する。
  # コードの列は controller_name の単数形 + "_code"(pathway_code / regimen_code)。
  #
  # include 先が持つもの:
  #   record_params       … 本体の属性(コード・承認日・承認者を含む permit)
  #   child_param_keys    … 子の配列を受けるパラメータ名(凍結中に送られたら内容の変更)
  #   master_label        … エラー文言に出す呼び名("パス" / "レジメン")
  #   parent_id_columns   … 子が持つ親の id 列(複製で付け替えるので写さない)
  #   replace_children / load_tree / validate_content! / copy_children / delete_children / detail
  module VersionedMaster
    extend ActiveSupport::Concern

    # 内容の検証に落ちたとき(モデル単体では判定できないもの)。
    class ContentInvalid < StandardError
      attr_reader :messages

      def initialize(messages)
        @messages = messages
        super(messages.join(" / "))
      end
    end

    SEARCH_COLUMNS = %w[search_name search_kana search_short_name].freeze

    # 承認済・廃止でも動かせる項目。内容(オーダーに影響するもの)は凍結し、
    # 「使うのをやめる」「並び順を変える」操作だけ残す。
    FROZEN_EDITABLE_ATTRS = %i[status valid_from valid_to display_order].freeze

    # サンプル(db/seed_data)が使う帯。施設の採番はこの手前で行う。
    SAMPLE_CODE_FLOOR = 900_000

    included do
      before_action :set_record, only: %i[show update destroy copy]
    end

    def show
      render json: detail(@record)
    end

    def create
      record = model_class.new(record_params.merge(approval_attrs(nil, record_params[:status])))
      record[code_column] = next_code if record[code_column].blank?
      tree = nil
      model_class.transaction do
        record.save!
        replace_children(record)
        tree = load_tree(record)
        validate_content!(record, tree)
      end
      render json: detail(record, tree), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    rescue ContentInvalid => e
      render json: { errors: e.messages }, status: :unprocessable_content
    end

    def update
      return render_frozen if frozen_change?
      return render_unapproval if unapproving?

      tree = nil
      model_class.transaction do
        @record.update!(update_params)
        replace_children(@record)
        tree = load_tree(@record)
        validate_content!(@record, tree)
      end
      render json: detail(@record, tree)
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    rescue ContentInvalid => e
      render json: { errors: e.messages }, status: :unprocessable_content
    end

    # 複製。改訂版の作り方。コードは新しく採番し、承認は引き継がず下書きに戻す。
    def copy
      target = model_class.new(
        @record.attributes.except("id", code_column.to_s, "created_at", "updated_at",
                                  "status", "approved_on", "approved_by",
                                  "search_name", "search_kana", "search_short_name"),
      )
      target[code_column] = next_code
      target.name = params[:name].presence || "#{@record.name}のコピー"
      target.status = "draft"
      # 改訂の系列を辿れるようにする(承認済は凍結し、直すときは複製するため)。
      target.copied_from_code = @record[code_column]
      # 有効期間・表示順は複製元の都合なので引き継がない(新しい版として決め直す)。
      target.valid_from = nil
      target.valid_to = nil
      target.display_order = nil
      model_class.transaction do
        target.save!
        copy_children(@record, target)
      end
      render json: detail(target), status: :created
    rescue ActiveRecord::RecordInvalid => e
      render_validation_errors(e.record)
    end

    # 削除できるのは下書きだけ。承認済・廃止は施設の記録として残す(患者への適用が指している)。
    def destroy
      if @record.status != "draft"
        return render json: { errors: ["承認済・廃止の#{master_label}は削除できません。廃止にして使わないようにしてください"] },
                      status: :unprocessable_content
      end

      model_class.transaction do
        delete_children(@record[code_column])
        @record.destroy!
      end
      head :no_content
    end

    private

    def code_column
      :"#{controller_name.singularize}_code"
    end

    # 更新で受ける値。承認日・承認者はサーバーが決める(画面からは送らせない)。
    def update_params
      permitted = record_params.except(code_column, :approved_on, :approved_by)
      permitted = permitted.slice(*FROZEN_EDITABLE_ATTRS) if frozen_record?
      permitted.merge(approval_attrs(@record.status, permitted[:status]))
    end

    # 承認済・廃止か(= 内容を凍結する)。
    def frozen_record?
      %w[approved retired].include?(@record.status)
    end

    # 凍結中に内容を変えようとしているか。子が 1 種類でも送られていれば内容の変更。
    def frozen_change?
      return false unless frozen_record?

      children_sent = child_param_keys.any? { |k| params.key?(k) }
      content_sent = record_params.except(code_column, :approved_on, :approved_by, *FROZEN_EDITABLE_ATTRS)
                                  .to_h.any? { |k, v| @record[k].to_s != v.to_s }
      children_sent || content_sent
    end

    # 承認済・廃止から下書きへは戻せない。戻せると「下書きにしてから直す」で凍結を
    # すり抜けられるため。使うのをやめるときは廃止にする。
    def unapproving?
      frozen_record? && record_params[:status] == "draft"
    end

    def render_unapproval
      render json: {
        errors: ["承認を取り消せません。使わないようにするには廃止にしてください"],
      }, status: :unprocessable_content
    end

    def render_frozen
      render json: {
        errors: ["承認済・廃止の#{master_label}は内容を変更できません。複製して新しい#{master_label}として直してください"],
      }, status: :unprocessable_content
    end

    # 承認の記録はサーバーが入れる(画面の手入力にしない)。下書き・廃止へ戻したら消す。
    def approval_attrs(previous_status, next_status)
      return {} if next_status.blank? || previous_status == next_status

      next_status == "approved" ? { approved_on: FacilityClock.today, approved_by: approver_id } : {}
    end

    # 承認者。認証なしモード(開発)ではパラメータを通す(order_sets の持ち主と同じ扱い)。
    def approver_id
      return params[:approved_by].presence if @user_auth == :none

      current_user&.practitioner_fhir_id
    end

    # 数字だけのコードの最大値の次(他マスタと同じ採番)。サンプルの 9000xx は数えない
    # (数えると seed 投入後の 1 件目が 900011 になり、帯を分けた意味が無くなる)。
    def next_code
      column = code_column
      max = model_class.where("#{column} ~ '^[0-9]+$'")
                       .where("#{column}::bigint < ?", SAMPLE_CODE_FLOOR)
                       .maximum(Arel.sql("#{column}::bigint"))
      ((max || 0) + 1).to_s.rjust(6, "0")
    end

    # id ではなくコードでも引けるようにする。
    def set_record
      @record = model_class.find_by(code_column => params[:id]) || model_class.find(params[:id])
    end

    def each_row(raw)
      Array(raw).each_with_index do |row, index|
        row = row.to_unsafe_h if row.respond_to?(:to_unsafe_h)
        yield row.to_h.stringify_keys, index
      end
    end

    # 行を検証してからまとめて INSERT し、入れた行の id を rows と同じ並びで返す
    # (unique_by を渡したときだけ。id の対応はその列で引き直し、RETURNING の並びには頼らない)。
    # 置換は子を全部消して入れ直すので、識別子の重なりは送られてきた配列の中だけを見ればよい
    # (duplicate_on にその属性を渡す。1 行ずつ DB の一意性検証に当てない)。
    def insert_rows(model, rows, unique_by: nil, duplicate_on: nil)
      return [] if rows.empty?

      records = rows.map { |row| model.new(row) }
      # 一意性はモデルでは :create のときだけ見るので、文脈を分けて DB への問い合わせを避ける。
      records.each { |record| raise ActiveRecord::RecordInvalid, record unless record.valid?(:replace) }
      detect_duplicates!(records, unique_by, duplicate_on) if duplicate_on
      # 既定値のある列も埋めた全列で入れる(insert_all は列の揃った行を要る)。
      values = records.map { |record| record.attributes.except("id", "created_at", "updated_at") }
      result = model.insert_all!(values, returning: ["id", *unique_by])
      return [] unless unique_by

      ids = result.to_a.to_h { |r| [unique_by.map { |c| r[c].to_s }, r["id"]] }
      records.map { |record| ids.fetch(unique_by.map { |c| record[c].to_s }) }
    end

    # 同じ親の中で重なった識別子。文言は 1 行ずつ作るときの一意性検証と同じものを使う。
    def detect_duplicates!(records, unique_by, attribute)
      seen = {}
      records.each do |record|
        key = unique_by.map { |column| record[column] }
        if seen[key]
          record.errors.add(attribute, uniqueness_message(record.class, attribute))
          raise ActiveRecord::RecordInvalid, record
        end
        seen[key] = true
      end
    end

    def uniqueness_message(model, attribute)
      model.validators_on(attribute)
           .find { |validator| validator.is_a?(ActiveRecord::Validations::UniquenessValidator) }
           .options[:message]
    end

    # rows を写して INSERT し、元の id → 写した行の id を返す。対応は親の中で一意なキー
    # (key_columns)で引き直し、RETURNING の並びには頼らない。子を持たない行は key_columns を空にする。
    # ブロックは行ごとに上書きする属性(付け替えた親の id など)を返す。
    def insert_copies(model, rows, key_columns, code)
      return {} if rows.empty?

      attrs = rows.map do |row|
        child_attrs(row).merge(code_column.to_s => code).merge(block_given? ? yield(row) : {})
      end
      result = model.insert_all!(attrs, returning: ["id", *key_columns])
      return {} if key_columns.empty?

      new_ids = result.to_a.to_h { |r| [key_columns.map { |c| r[c].to_s }, r["id"]] }
      rows.zip(attrs).to_h { |row, attr| [row.id, new_ids.fetch(key_columns.map { |c| attr[c].to_s })] }
    end

    def child_attrs(record)
      record.attributes.except("id", code_column.to_s, "created_at", "updated_at", *parent_id_columns)
    end
  end
end
