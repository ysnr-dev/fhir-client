module Master
  # JJ1017 の部品コード(手技・部位・体位・撮影方向など)。配布ファイル由来の
  # 標準コード(source=official)は取込で洗い替え、画面からは施設独自の
  # 拡張コード(source=local)だけを登録・編集・削除する。
  class RadJj1017CodesController < BaseController
    before_action :set_record, only: %i[update destroy]

    def index
      scope = Master::RadJj1017Code.all
      scope = scope.where(element: params[:element]) if params[:element].present?
      # カンマ区切りで複数指定可(オーダー項目の各要素の名称を一括解決するため)。
      scope = scope.where(code: params[:code].split(",")) if params[:code].present?
      scope = scope.where(source: params[:source]) if params[:source].present?
      # 部位の候補をモダリティ別の使用可否で絞る(一般撮影系 / CT / MR / US)。
      scope = scope.where(modality_column(params[:modality_use]) => true) if modality_column(params[:modality_use])
      if params[:name].present?
        scope = flexible_name_match(scope, params[:name], %w[search_name])
      end
      render json: paginate(scope.order(Arel.sql("display_order NULLS LAST")).order(:code))
    end

    # 要素の一覧(32桁コード内の位置・桁数・施設拡張の可否と範囲)。
    # 拡張コード登録画面の要素セレクタと入力チェックの案内、オーダー項目編集画面の
    # 32桁コードのプレビューを、これ1つで組み立てられるようにする。
    # 桁の割り当てはサーバー側(Master::Jj1017Code)だけが持つ。
    def elements
      counts = Master::RadJj1017Code.group(:element, :source).count

      list = Master::Jj1017Code::ELEMENTS.map do |name, spec|
        {
          element: name,
          label: spec[:label],
          table: spec[:table],
          offset: spec[:offset],
          length: spec[:length],
          extension_allowed: !spec[:extension].nil?,
          extension_label: spec[:extension_label],
          official_count: counts[[name, Master::RadJj1017Code::OFFICIAL]] || 0,
          local_count: counts[[name, Master::RadJj1017Code::LOCAL]] || 0
        }
      end

      render json: {
        code_length: Master::Jj1017Code::CODE_LENGTH,
        generic_extension: {
          offset: Master::Jj1017Code::GENERIC_EXTENSION_OFFSET,
          length: Master::Jj1017Code::GENERIC_EXTENSION_LENGTH
        },
        elements: list
      }
    end

    # 全要素のコードを要素名でまとめて返す。オーダー項目の編集画面は11要素すべての
    # 選択肢を同時に必要とするため、要素ごとにページングして引くと画面が組み立たない。
    # 部品コード表は全要素あわせても2千件弱なので、この画面用に一括で返す。
    def catalog
      grouped = Master::RadJj1017Code
        .order(Arel.sql("display_order NULLS LAST")).order(:code)
        .group_by(&:element)

      render json: grouped.transform_values { |codes|
        codes.map do |code|
          code.as_json(only: %w[
            id element code name name_english common_name source
            major_part_code organ_system_code use_general use_ct use_mr use_us
          ])
        end
      }
    end

    # 画面から作れるのは施設拡張コードだけ。
    def create
      record = Master::RadJj1017Code.new(record_params)
      record.source = Master::RadJj1017Code::LOCAL
      if record.save
        render json: record, status: :created
      else
        render json: { errors: record.errors.full_messages }, status: :unprocessable_content
      end
    end

    def update
      return render_official_readonly if @record.official?

      if @record.update(record_params.except("source", "element", "code"))
        render json: @record
      else
        render json: { errors: @record.errors.full_messages }, status: :unprocessable_content
      end
    end

    # 使用中の拡張コードは消させない。外部キーを張っていないので、
    # オーダー項目マスタの該当要素の列を直接見て確かめる。
    def destroy
      return render_official_readonly if @record.official?

      used = Master::RadItem.where(Master::RadItem.element_column(@record.element) => @record.code).count
      if used.positive?
        return render json: { errors: ["放射線オーダー項目#{used}件で使用中のため削除できません"] },
                      status: :unprocessable_content
      end

      @record.destroy!
      head :no_content
    end

    def import
      return render json: { error: "file is required" }, status: :unprocessable_content if params[:file].blank?

      result = MasterImport::RadJj1017CodeImporter.call(params[:file])
      render json: {
        imported: result.imported_count,
        skipped: result.skipped_count,
        elements: result.element_counts
      }
    end

    private

    def render_official_readonly
      render json: { errors: ["配布ファイル由来の標準コードは編集できません"] },
             status: :unprocessable_content
    end

    def modality_column(value)
      { "general" => :use_general, "ct" => :use_ct, "mr" => :use_mr, "us" => :use_us }[value]
    end

    def set_record
      @record = Master::RadJj1017Code.find(params[:id])
    end

    def record_params
      params.permit(Master::RadJj1017Code.column_names - %w[id created_at updated_at])
    end
  end
end
