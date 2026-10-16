module Intake
  # Web 問診のリンクの発行(docs/web-intake-design.md §2)。
  #
  # 予約(Appointment)か患者から、患者・生年月日・診療科を上流で読み、答えてもらう質問票と有効期限を決めて
  # IntakeLink を作る。同じ予約(予約が無ければ同じ患者)の有効なリンクは無効にし、常に新しいトークンを返す
  # (トークンは保存しないので再表示できない。発行し直す方が運用が単純)。
  class LinkIssuer
    class InvalidRequest < StandardError; end

    Result = Struct.new(:link, :token, keyword_init: true)

    def initialize(store: Integrations::FhirStore.new, settings: FacilitySettings.intake)
      @store = store
      @settings = settings
    end

    def call(appointment_id: nil, patient_id: nil, questionnaire_urls: nil, created_by: nil)
      appointment = appointment_id.present? ? store.read("Appointment", appointment_id) : nil
      patient_fhir_id = patient_id.presence || appointment_patient_id(appointment)
      raise InvalidRequest, "予約に患者が無いためリンクを発行できません" if patient_fhir_id.blank?

      patient = store.read("Patient", patient_fhir_id)
      urls = resolve_questionnaires(questionnaire_urls, appointment)
      raise InvalidRequest, "答えてもらう質問票が決まっていません(施設設定の Web 問診を確認してください)" if urls.empty?

      IntakeLink.transaction do
        revoke_previous(appointment_id, patient_fhir_id)
        link, token = IntakeLink.issue!(
          appointment_fhir_id: appointment_id.presence,
          patient_fhir_id: patient_fhir_id,
          questionnaire_urls: urls,
          birth_date: patient["birthDate"].to_s.presence,
          expires_at: expires_at(appointment),
          created_by_id: created_by&.dig(:id),
          created_by_name: created_by&.dig(:name)
        )
        Result.new(link: link, token: token)
      end
    end

    private

    attr_reader :store, :settings

    # participant のうち Patient を指すもの(先頭とは限らない前提で探す)。
    def appointment_patient_id(appointment)
      return nil unless appointment

      reference = Array(appointment["participant"]).map { |p| p.dig("actor", "reference").to_s }
                                                     .find { |ref| ref.start_with?("Patient/") }
      reference&.delete_prefix("Patient/")
    end

    # 引数 → 診療科の既定 → 施設の既定。
    def resolve_questionnaires(explicit, appointment)
      return Array(explicit).map(&:to_s).reject(&:blank?).uniq if Array(explicit).any?(&:present?)

      department = appointment&.dig("specialty", 0, "coding", 0, "code").to_s
      by_department = Array(settings.dig("by_department", department))
      return by_department if department.present? && by_department.any?

      Array(settings["questionnaires"])
    end

    # 予約があればその日の翌日の終わり(日本時間)、無ければ設定の時間後。
    def expires_at(appointment)
      day = Integrations::ReceiptComputer::LocalDate.of(appointment&.dig("start"))
      if day.present?
        (Date.parse(day) + 1).in_time_zone(FacilityClock::ZONE).end_of_day
      else
        Time.current + settings.fetch("expires_hours", 24).to_i.hours
      end
    end

    def revoke_previous(appointment_id, patient_fhir_id)
      scope = IntakeLink.active
      scope = appointment_id.present? ? scope.where(appointment_fhir_id: appointment_id) : scope.where(patient_fhir_id: patient_fhir_id, appointment_fhir_id: nil)
      scope.update_all(revoked_at: Time.current)
    end
  end
end
