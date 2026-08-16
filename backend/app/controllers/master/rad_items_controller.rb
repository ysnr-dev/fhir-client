module Master
  # 放射線オーダー項目のメンテナンス。画面から手動で登録し、JJ1017 の各要素は
  # 部品コードマスタ(master_rad_jj1017_codes)から選ぶ。頻用コード表からの
  # 一括作成もここが持つ。
  class RadItemsController < BaseController
    before_action :set_record, only: %i[show update destroy]

    def index
      scope = Master::RadItem.all
      # カンマ区切りで複数指定可(保存済みのオーダーから項目情報を一括復元するため)。
      scope = scope.where(item_code: params[:item_code].split(",")) if params[:item_code].present?
      scope = scope.where(kind: params[:kind]) if params[:kind].present?
      # オーダー単位(groupable=true グループ化 / false 単独)での絞り込み。
      scope = scope.where(groupable: params[:groupable] == "true") if params[:groupable].present?
      scope = scope.where(modality_code: params[:modality_code]) if params[:modality_code].present?
      scope = scope.where(body_part_code: params[:body_part_code]) if params[:body_part_code].present?
      # active=true は今日オーダーできる項目(有効期間内)だけに絞る。
      if params[:active] == "true"
        scope = scope
          .where("valid_from IS NULL OR valid_from <= ?", Date.current)
          .where("valid_to IS NULL OR valid_to >= ?", Date.current)
      end
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name search_short_name search_kana])
      end
      # 名称・種別(モダリティ)・部位を1つの語でまとめて探す(その場で項目を足す検索欄用)。
      scope = keyword_match(scope, params[:keyword]) if params[:keyword].present?

      result = paginate(scope.order(Arel.sql("display_order NULLS LAST")))
      # 一覧でも種別(モダリティ)の名称くらいは出したいので、載っている要素の
      # 名称をまとめて引いて添える。
      render json: result.merge(elements: element_names_for(result[:items]))
    end

    # 要素の名称・セット構成・実施入力用データセットの名称をまとめて返す。
    # 詳細画面が1リクエストで開けるようにする。
    def show
      set_items = set_items_for(@record.item_code).to_a
      # 構成項目の種別(モダリティ)・部位も画面に出すため、名称の解決には
      # セットに載っている項目そのものも含める。
      members = Master::RadItem.where(item_code: set_items.map(&:member_item_code)).to_a
      render json: @record.as_json.merge(
        elements: element_names_for([@record, *members]),
        set_items: set_items.as_json,
        dataset_name: dataset_name_for(@record.dataset_code)
      )
    end

    def create
      record = Master::RadItem.new(record_params)
      record.item_code = next_item_code if record.item_code.blank?
      if record.save
        render json: record, status: :created
      else
        render json: { errors: record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def update
      if @record.update(record_params)
        render json: @record
      else
        render json: { errors: @record.errors.full_messages }, status: :unprocessable_content
      end
    end

    # 外部キーを張っていないので、ぶら下がるセット構成も併せて片付ける
    # (データセットは項目の列で参照しているだけなので、本体は消さない)。
    def destroy
      code = @record.item_code
      Master::RadItem.transaction do
        Master::RadSetItem.where(set_item_code: code).delete_all
        Master::RadSetItem.where(member_item_code: code).delete_all
        @record.destroy!
      end
      head :no_content
    end

    # 頻用コード表(別表F)から選んだ32桁コードを要素に分解し、単項目として
    # まとめて登録する。既に同じ32桁コードの項目があれば作らない。
    def bulk_create_from_frequent
      ids = Array(params[:frequent_code_ids]).map(&:to_i).select(&:positive?)
      return render json: { errors: ["頻用コードを選択してください"] }, status: :unprocessable_content if ids.empty?

      sources = Master::RadJj1017FrequentCode.where(id: ids)
      # 選択順ではなく掲載順で作る(項目コードの並びが頻用コード表と揃うように)。
      sources = sources.order(Arel.sql("display_order NULLS LAST")).order(:id)

      created = []
      skipped = []
      errors = []
      existing = Master::RadItem.where(jj1017_code: sources.map(&:jj1017_code)).pluck(:jj1017_code).to_set
      sequence = next_item_code_sequence

      Master::RadItem.transaction do
        sources.each do |source|
          if existing.include?(source.jj1017_code)
            skipped << { jj1017_code: source.jj1017_code, name: source.name }
            next
          end

          record = build_from_frequent(source, sequence)
          if record.save
            created << record
            existing << source.jj1017_code
            sequence += 1
          else
            errors << { jj1017_code: source.jj1017_code, name: source.name,
                        messages: record.errors.full_messages }
          end
        end
      end

      render json: { created: created.size, skipped: skipped, errors: errors, items: created }
    end

    private

    # 1つの検索欄で当てにいく要素。項目の名称にはモダリティ・部位が入っていない
    # ことも多く(「頭部単純Ｘ線 2方向」など)、要素からも引けると探しやすい。
    KEYWORD_ELEMENTS = %w[modality body_part].freeze

    # 名称・略称・カナに加えて、種別(モダリティ)・部位の名称にも当てる。要素の
    # 名称は部品コードマスタにしか無いので、その語に当たるコードを引いて照合する。
    # 表記ゆれの吸収は双方の search_name(正規化済み)に任せる。
    def keyword_match(scope, query)
      conn = ActiveRecord::Base.connection

      Master::SearchNormalizer.tokenize(query).each do |token|
        pattern = conn.quote("%#{sanitize_like(token)}%")
        clauses = %w[search_name search_short_name search_kana].map { |column| "#{column} LIKE #{pattern}" }
        KEYWORD_ELEMENTS.each do |element|
          clauses << "#{Master::RadItem.element_column(element)} IN " \
                     "(SELECT code FROM master_rad_jj1017_codes " \
                     "WHERE element = #{conn.quote(element)} AND search_name LIKE #{pattern})"
        end
        scope = scope.where(clauses.join(" OR "))
      end

      scope
    end

    def build_from_frequent(source, sequence)
      elements = source.elements
      attrs = Master::RadItem::ELEMENT_COLUMNS.to_h { |element, column| [column, elements[element]] }
      Master::RadItem.new(attrs).tap do |record|
        record.item_code = format_item_code(sequence)
        record.name = source.name
        record.kind = "single"
        record.generic_extension_code = elements["generic_extension"]
        record.valid_from = Date.current
      end
    end

    # 項目に載っている要素コードを {要素名 => {コード => 名称}} でまとめて引く。
    # 外部キーが無いぶん、画面が名称を出すのに必要な分だけをここで解決する。
    def element_names_for(items)
      wanted = Hash.new { |hash, key| hash[key] = Set.new }
      items.each do |item|
        Master::RadItem::ELEMENT_COLUMNS.each do |element, column|
          value = item[column]
          wanted[element] << value if value.present?
        end
      end
      return {} if wanted.empty?

      clauses = []
      binds = []
      wanted.each do |element, codes|
        clauses << "(element = ? AND code IN (?))"
        binds.push(element, codes.to_a)
      end

      Master::RadJj1017Code
        .where(clauses.join(" OR "), *binds)
        .pluck(:element, :code, :name).each_with_object({}) do |(element, code, name), map|
        (map[element] ||= {})[code] = name
      end
    end

    def set_items_for(code)
      Master::RadSetItem
        .where(set_item_code: code)
        .joins("LEFT JOIN master_rad_items " \
               "ON master_rad_items.item_code = master_rad_set_items.member_item_code")
        .select(
          "master_rad_set_items.*",
          "master_rad_items.name AS member_name",
          "master_rad_items.short_name AS member_short_name",
          "master_rad_items.jj1017_code AS member_jj1017_code",
          "master_rad_items.modality_code AS member_modality_code",
          "master_rad_items.body_part_code AS member_body_part_code",
        )
        .order(Arel.sql("master_rad_set_items.display_order NULLS LAST"))
        .order(:id)
    end

    # 参照している実施入力用データセットの名称。詳細画面が選択中の名前を出すのに使う。
    def dataset_name_for(code)
      return nil if code.blank?

      Master::RadDataset.where(dataset_code: code).pick(:name)
    end

    # 数字だけの項目コードの最大値の次。手入力の英字混じりコードは無視する。
    def next_item_code_sequence
      max = Master::RadItem.where("item_code ~ '^[0-9]+$'").maximum(Arel.sql("item_code::bigint"))
      (max || 0) + 1
    end

    def next_item_code
      format_item_code(next_item_code_sequence)
    end

    def format_item_code(sequence)
      sequence.to_s.rjust(6, "0")
    end

    def set_record
      # id ではなく項目コードでも引けるようにする。
      @record = Master::RadItem.find_by(item_code: params[:id]) || Master::RadItem.find(params[:id])
    end

    def record_params
      params.permit(Master::RadItem.column_names - %w[id jj1017_code created_at updated_at])
    end
  end
end
