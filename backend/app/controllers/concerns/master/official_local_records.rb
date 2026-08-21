module Master
  # official/local 混在マスタ(JANIS コード表・JJ1017 部品コード)の共通ルール。
  # 配布ファイル由来の標準コード(source=official)は取込で洗い替えるため画面からは
  # 書き換えさせず、施設追加分(source=local)だけを登録・編集・削除できる。
  # official の一部だけ編集を許すマスタ(頻用の印など)は update をオーバーライドする。
  module OfficialLocalRecords
    # 画面から作れるのは施設追加コードだけ。
    def create
      record = model_class.new(record_params)
      record.source = model_class::LOCAL
      if record.save
        render json: record, status: :created
      else
        render_validation_errors(record)
      end
    end

    def update
      return render_official_readonly if @record.official?

      if @record.update(record_params.except(*protected_record_keys))
        render json: @record
      else
        render_validation_errors(@record)
      end
    end

    def destroy
      return render_official_readonly if @record.official?

      @record.destroy!
      head :no_content
    end

    private

    # local でも書き換えを許さない列。コードが別の値になりすますのを防ぐ。
    def protected_record_keys
      %w[source code]
    end

    def render_official_readonly
      render json: { errors: ["配布ファイル由来の標準コードは編集できません"] },
             status: :unprocessable_content
    end

    # 検索用カラムはモデルの before_save が埋めるので受け付けない。
    def record_params
      permitted = model_class.column_names - %w[id created_at updated_at] -
                  model_class.column_names.grep(/\Asearch_/)
      params.permit(permitted)
    end
  end
end
