# 保存済みの DicomInstance の行から、上流に置く ImagingStudy を組み立てる。
# 行の現状をそのまま写すので、追加取込でも再送でも「組み立て直して置き換える」だけで揃う。
#
# インスタンスの実体の URL は ImagingStudy に書かない。SOP Instance UID から
# /imaging/instances/<uid> と決まるため。
class ImagingStudyBuilder
  DICOM_UID_SYSTEM = "urn:dicom:uid".freeze
  DCM_SYSTEM = "http://dicom.nema.org/resources/ontology/DCM".freeze
  SOP_CLASS_SYSTEM = "urn:ietf:rfc:3986".freeze
  IDENTIFIER_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0203".freeze
  # 取込元(DICOM のタグに書かれていた施設と患者)。他院の CD では、カルテの患者とは
  # 別の患者番号・表記が入っている。
  SOURCE_EXTENSION_URL = "http://fhir-client.local/StructureDefinition/imaging-source".freeze
  TIME_OFFSET = "+09:00".freeze

  def self.study_identifier_value(study_uid)
    "urn:oid:#{study_uid}"
  end

  # instances は同じ患者・同じスタディの行(1 件以上)。
  def initialize(instances)
    @instances = instances.to_a
    raise ArgumentError, "instances is empty" if @instances.empty?

    @head = @instances.first
  end

  def build
    series = build_series
    resource = {
      "resourceType" => "ImagingStudy",
      "identifier" => identifiers,
      "status" => "available",
      "subject" => { "reference" => "Patient/#{head.patient_id}" },
      "numberOfSeries" => series.size,
      "numberOfInstances" => instances.size,
      "series" => series
    }
    resource["started"] = started if started
    modalities = instances.filter_map { |i| i.modality.presence }.uniq
    resource["modality"] = modalities.map { |code| modality_coding(code) } if modalities.any?
    resource["description"] = head.study_description if head.study_description.present?
    resource["extension"] = [source_extension] if source_extension
    resource
  end

  private

  attr_reader :instances, :head

  def identifiers
    list = [{ "system" => DICOM_UID_SYSTEM, "value" => self.class.study_identifier_value(head.study_instance_uid) }]
    accession = first_present(:accession_number)
    if accession
      list << {
        "type" => { "coding" => [{ "system" => IDENTIFIER_TYPE_SYSTEM, "code" => "ACSN" }] },
        "value" => accession
      }
    end
    list
  end

  # StudyDate(YYYYMMDD) と StudyTime(HHMMSS.ffffff)。時刻が無ければ日付だけにする。
  def started
    date = first_present(:study_date).to_s
    return nil unless date.match?(/\A\d{8}\z/)

    day = "#{date[0, 4]}-#{date[4, 2]}-#{date[6, 2]}"
    time = first_present(:study_time).to_s[/\A\d{2,6}/].to_s
    return day if time.length < 4

    "#{day}T#{time[0, 2]}:#{time[2, 2]}:#{time[4, 2].presence || '00'}#{TIME_OFFSET}"
  end

  def build_series
    instances.group_by(&:series_instance_uid).map do |series_uid, rows|
      first = rows.first
      series = { "uid" => series_uid }
      series["number"] = first.series_number if first.series_number
      # series.modality は 1..1。タグに無いファイルは OT(Other)として載せる。
      series["modality"] = modality_coding(rows.filter_map { |r| r.modality.presence }.first || "OT")
      description = rows.filter_map { |r| r.series_description.presence }.first
      series["description"] = description if description
      series["numberOfInstances"] = rows.size
      body_part = rows.filter_map { |r| r.body_part.presence }.first
      series["bodySite"] = { "display" => body_part } if body_part
      series["instance"] = rows.map { |row| build_instance(row) }
      series
    end
  end

  def build_instance(row)
    instance = {
      "uid" => row.sop_instance_uid,
      "sopClass" => { "system" => SOP_CLASS_SYSTEM, "code" => "urn:oid:#{row.sop_class_uid}" }
    }
    instance["number"] = row.instance_number if row.instance_number
    instance
  end

  def modality_coding(code)
    { "system" => DCM_SYSTEM, "code" => code }
  end

  def source_extension
    @source_extension ||= begin
      parts = {
        "institutionName" => first_present(:institution_name),
        "patientId" => first_present(:source_patient_id),
        "patientName" => first_present(:source_patient_name)
      }.compact
      if parts.any?
        {
          "url" => SOURCE_EXTENSION_URL,
          "extension" => parts.map { |url, value| { "url" => url, "valueString" => value } }
        }
      end
    end
  end

  def first_present(attribute)
    instances.filter_map { |i| i.public_send(attribute).presence }.first
  end
end
