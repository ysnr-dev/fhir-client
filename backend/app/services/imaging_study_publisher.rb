# 取り込んだスタディの ImagingStudy を上流に置く・消す。
# スタディは DICOM の Study Instance UID(identifier)で特定するので、上流の id を
# こちらで覚えておく必要は無い。
class ImagingStudyPublisher
  class UpstreamError < StandardError; end

  FHIR_CONTENT_TYPE = "application/fhir+json".freeze

  def initialize(patient_id, study_uid, gateway: FhirGateway.new)
    @patient_id = patient_id
    @study_uid = study_uid
    @gateway = gateway
  end

  # 保存済みの行から組み立てた ImagingStudy で置き換える(無ければ作る)。
  # 上流の ImagingStudy を返す。
  def publish(instances)
    resource = ImagingStudyBuilder.new(instances).build
    upstream = gateway.forward(
      method: :put, path: "/ImagingStudy", query: identifier_query, body: resource.to_json,
      headers: { "Content-Type" => FHIR_CONTENT_TYPE, "Accept" => FHIR_CONTENT_TYPE }
    )
    ensure_success!(upstream, "ImagingStudy conditional update")
    JSON.parse(upstream.body)
  end

  # 上流の ImagingStudy を消す。もともと無い(commit 前に中断した取込)のは成功として扱う。
  def unpublish
    upstream = gateway.forward(
      method: :delete, path: "/ImagingStudy",
      query: "#{identifier_query}&patient=#{CGI.escape(patient_id)}",
      headers: { "Accept" => FHIR_CONTENT_TYPE }
    )
    return if upstream.status == 404

    ensure_success!(upstream, "ImagingStudy conditional delete")
  end

  private

  attr_reader :patient_id, :study_uid, :gateway

  def identifier_query
    token = "#{ImagingStudyBuilder::DICOM_UID_SYSTEM}|#{ImagingStudyBuilder.study_identifier_value(study_uid)}"
    "identifier=#{CGI.escape(token)}"
  end

  def ensure_success!(upstream, context)
    return if (200..299).cover?(upstream.status)

    raise UpstreamError, "upstream returned #{upstream.status} for #{context}"
  end
end
