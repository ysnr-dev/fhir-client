module Master
  # official/local 混在マスタ(OfficialLocalRecords)のうち、標準コード(source=official)でも
  # 頻用の印(frequent)だけは画面から切り替えられるもの(JANIS の菌・抗菌薬、JAHIS の病理臓器)。
  # OfficialLocalRecords の後に include して update / destroy を差し替える。
  module FrequentOfficialRecords
    def update
      permitted = @record.official? ? record_params.slice("frequent") : record_params.except(*protected_record_keys)
      if @record.update(permitted)
        render json: @record
      else
        render_validation_errors(@record)
      end
    end

    def destroy
      if @record.official?
        return render json: { errors: ["#{official_source_label}由来の標準コードは削除できません"] },
                      status: :unprocessable_content
      end

      @record.destroy!
      head :no_content
    end

    private

    # 標準コードの出どころ(削除を断る文言に使う)。
    def official_source_label
      "配布ファイル"
    end
  end
end
