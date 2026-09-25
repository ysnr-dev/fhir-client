module Master
  # 患者ごとにマルチチャートで最初に開くチャート(ピン留め)。患者につき 1 つで、利用者の間で
  # 共有する。チャート定義と同じく /master の基底(ログイン認証・CSRF・エラー整形)に乗せる。
  class PatientChartPinsController < BaseController
    # ピンが無い患者も 200 で chart_definition_id: null を返す(画面は毎回引くので、
    # 無いのが普通の状態を 404 にしない)。
    def show
      pin = PatientChartPin.find_by(patient_id: params[:patient_id])
      render json: detail(pin)
    end

    # ピン留め。すでにあれば置き換える(患者につき 1 つ)。
    def update
      definition = ChartDefinition.find(params.require(:chart_definition_id))
      pin = PatientChartPin.find_or_initialize_by(patient_id: params[:patient_id])
      pin.assign_attributes(
        chart_definition: definition,
        pinned_by_id: current_user&.practitioner_fhir_id,
        pinned_by_name: params[:pinned_by_name].presence,
      )
      if pin.save
        render json: detail(pin)
      else
        render_validation_errors(pin)
      end
    end

    def destroy
      PatientChartPin.where(patient_id: params[:patient_id]).delete_all
      head :no_content
    end

    private

    def detail(pin)
      {
        patient_id: params[:patient_id],
        chart_definition_id: pin&.chart_definition_id,
        pinned_by_id: pin&.pinned_by_id,
        pinned_by_name: pin&.pinned_by_name,
        updated_at: pin&.updated_at,
      }
    end
  end
end
