// 取り込んだ DICOM のスタディ(ImagingStudy。docs/imaging-design.md)の読み取り。
// ImagingStudy を書くのは backend なので、ここに組み立てる側は無い。

export const DICOM_UID_SYSTEM = "urn:dicom:uid";
const UID_PREFIX = "urn:oid:";
/** 取込元(DICOM のタグに書かれていた施設と患者)。 */
export const IMAGING_SOURCE_EXT_URL =
  "http://fhir-client.local/StructureDefinition/imaging-source";

/** 一覧で series を落として軽く引くための _elements(上流は JSON のキー名で照合する)。 */
export const IMAGING_STUDY_SUMMARY_ELEMENTS = [
  "identifier",
  "status",
  "subject",
  "started",
  "modality",
  "description",
  "numberOfSeries",
  "numberOfInstances",
  "extension",
].join(",");

export interface ImagingStudySummary {
  id: string;
  studyUid: string;
  /** 検査日(YYYY-MM-DD)。タグに無かったスタディは空。 */
  date: string;
  /** 検査時刻(HH:mm)。 */
  time: string;
  modalities: string[];
  description: string;
  numberOfSeries: number;
  numberOfInstances: number;
  institutionName: string;
  sourcePatientId: string;
  sourcePatientName: string;
}

export interface ImagingSeries {
  uid: string;
  number: number | undefined;
  modality: string;
  description: string;
  bodySite: string;
  instances: ImagingInstance[];
}

export interface ImagingInstance {
  uid: string;
  sopClassUid: string;
  number: number | undefined;
}

export function studyUidOf(study: fhir4.ImagingStudy): string {
  const value = study.identifier?.find((i) => i.system === DICOM_UID_SYSTEM)?.value ?? "";
  return value.startsWith(UID_PREFIX) ? value.slice(UID_PREFIX.length) : value;
}

function sourcePart(study: fhir4.ImagingStudy, url: string): string {
  const source = study.extension?.find((e) => e.url === IMAGING_SOURCE_EXT_URL);
  return source?.extension?.find((e) => e.url === url)?.valueString ?? "";
}

export function parseImagingStudy(study: fhir4.ImagingStudy): ImagingStudySummary {
  // started は backend が +09:00 で書く。日付と時刻は文字列のまま切り出す
  // (Date を経由すると閲覧端末のタイムゾーンで日付が動く)。
  const started = study.started ?? "";
  return {
    id: study.id ?? "",
    studyUid: studyUidOf(study),
    date: started.slice(0, 10),
    time: started.length > 10 ? started.slice(11, 16) : "",
    modalities: (study.modality ?? []).map((m) => m.code ?? "").filter(Boolean),
    description: study.description ?? "",
    numberOfSeries: study.numberOfSeries ?? 0,
    numberOfInstances: study.numberOfInstances ?? 0,
    institutionName: sourcePart(study, "institutionName"),
    sourcePatientId: sourcePart(study, "patientId"),
    sourcePatientName: sourcePart(study, "patientName"),
  };
}

const byNumber = (a: { number?: number }, b: { number?: number }) =>
  (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER);

/** シリーズ番号 → インスタンス番号の順に並べたシリーズ。 */
export function sortedSeries(study: fhir4.ImagingStudy): ImagingSeries[] {
  return (study.series ?? [])
    .map((series): ImagingSeries => ({
      uid: series.uid,
      number: series.number,
      modality: series.modality?.code ?? "",
      description: series.description ?? "",
      bodySite: series.bodySite?.display ?? "",
      instances: (series.instance ?? [])
        .map((instance): ImagingInstance => ({
          uid: instance.uid,
          sopClassUid: (instance.sopClass?.code ?? "").replace(UID_PREFIX, ""),
          number: instance.number,
        }))
        .sort(byNumber),
    }))
    .sort(byNumber);
}

// 画像ではない SOP Class(レポート・PDF・表示状態・波形など)。取り込みはするが、
// ビューアには出せない。
const NON_IMAGE_SOP_CLASS_PREFIXES = [
  "1.2.840.10008.5.1.4.1.1.88.", // SR(線量レポート、Key Object Selection を含む)
  "1.2.840.10008.5.1.4.1.1.104.", // Encapsulated PDF / CDA
  "1.2.840.10008.5.1.4.1.1.11.", // Presentation State
  "1.2.840.10008.5.1.4.1.1.9.", // Waveform
  "1.2.840.10008.5.1.4.1.1.66", // Raw Data / Registration / Segmentation
];

export function isDisplayableSopClass(sopClassUid: string): boolean {
  return !NON_IMAGE_SOP_CLASS_PREFIXES.some((prefix) => sopClassUid.startsWith(prefix));
}

export function isDisplayableSeries(series: ImagingSeries): boolean {
  return series.instances.some((instance) => isDisplayableSopClass(instance.sopClassUid));
}

/** インスタンスの実体(.dcm)の URL。SOP Instance UID だけで決まる。 */
export function imagingInstanceUrl(patientId: string, sopInstanceUid: string): string {
  return `/imaging/instances/${sopInstanceUid}?patient=${encodeURIComponent(patientId)}`;
}

export interface ImagingStudyDayGroup {
  date: string;
  studies: ImagingStudySummary[];
}

/** 検査日の降順に並んだ一覧を、同じ日の連続区間でまとめる。日付なしは末尾へ寄せる。 */
export function groupImagingStudiesByDate(
  studies: readonly ImagingStudySummary[],
): ImagingStudyDayGroup[] {
  const groups: ImagingStudyDayGroup[] = [];
  for (const study of studies) {
    const last = groups[groups.length - 1];
    if (last && last.date === study.date) last.studies.push(study);
    else groups.push({ date: study.date, studies: [study] });
  }
  const undated = groups.filter((group) => group.date === "");
  return undated.length === 0 ? groups : [...groups.filter((g) => g.date !== ""), ...undated];
}
