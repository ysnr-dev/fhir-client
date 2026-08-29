import { today } from "../lib/dates";
import {
  SETTING_SYSTEM,
  type LabResultSetting,
  observationIdsFromReport,
} from "./labResultHelpers";
import { categoryCoding, codingBySystem, findSettingDisplay } from "./shared";
import { departmentExtension, departmentOf } from "./prescriptionHelpers";
import type { SchemaImageRef } from "./questionnaireResponseHelpers";
import { binaryIdFromAttachment, imageBinaryEntry } from "./schemaImage";
import {
  ORGAN_SYSTEM,
  SPECIMEN_TYPE_SYSTEM,
  isCytologyCategory,
  type PathoExamCategory,
} from "./pathoOrderHelpers";

// 病理診断レポート。細菌検査結果(microResultHelpers)と同型の
//
//   DiagnosticReport ─ basedOn → 病理検査オーダー(ヘッダ ServiceRequest)
//     ├ specimen → Specimen ×N(臓器・検体タイプ・実採取日)
//     └ result  → Observation 群(所見・診断)
//
// を 1 本の transaction Bundle で保存する。
//
// 所見・診断の項目立ては JAHIS 病理診断レポート構造化記述規約 Ver.2.0 の
// セクション構成に合わせ、Observation.code にそのセクションの LOINC を直接使う。
//
//   肉眼所見 22634-0 / 顕微鏡所見 22635-7 / 診断 22637-3 / 採取法・検体処理法 10157-6
//
// 規約では診断セクションだけが必須。組織診・術中迅速の診断は取扱い規約や UICC の
// 病期を含む自由文なので valueString、細胞診は「判定 + 推定病変」の形なので
// valueCodeableConcept(判定) + component(推定病変)にする(規約の記述サンプルに従う)。
//
// 臨床情報・検体情報セクションに当たる内容(臨床経過、臓器・採取法)はオーダー側に
// 既にあるため、レポートには重複して持たせない。検体だけは「実際に採れた検体」として
// 独立 Specimen を作る(オーダーは予定、レポートは実績)。
//
// 報告の確定は status で表す。中間報告(preliminary)→ 最終報告(final)→ 確定後の
// 修正は amended。amended への遷移は build 側が自動で行う(診療記録
// clinicalNoteHelpers と同じ規約。確定した記録を編集したのに final のままだと、
// 後から見て「一度も直していない最終報告」と区別が付かなくなるため)。

// ---- コードシステム ----

const LOINC_SYSTEM = "http://loinc.org";
// JAHIS 病理診断レポート構造化記述規約 のセクションコード(すべて LOINC)。
const LOINC_PATHO_REPORT_CODE = "11526-1"; // Pathology study(一般病理診断レポート)
const CODE_GROSS = "22634-0"; // Pathology report gross observation(肉眼所見)
const CODE_MICROSCOPIC = "22635-7"; // Pathology report microscopic observation(顕微鏡所見)
const CODE_DIAGNOSIS = "22637-3"; // Pathology report diagnosis(診断)
const CODE_PROCEDURE_STEP = "10157-6"; // Special treatments and procedures(採取法／検体処理法)

// 細胞診の判定。領域別の分類(ベセスダ等)は持たず、汎用の 5 段階にする
// (docs/patho-order-design.md §8)。
const CYTO_JUDGEMENT_SYSTEM = "http://fhir-client.local/CodeSystem/patho-cyto-judgement";

// レポートに添える画像(肉眼写真・鏡検写真・切り出し図)。
// 規約 20-004 はレポートを本文セクションだけで定義していて画像を規定していないため、
// 持ち方はこのアプリの既定に合わせる: 画像は Binary、参照は valueAttachment。
// DiagnosticReport.media は Reference(Media) を要求するが Media は上流で扱えないので使わない。
// 種別と説明を添えるので複合拡張にする(手術の輸血準備と同じ形)。
const REPORT_IMAGE_EXT_URL = "http://fhir-client.local/StructureDefinition/patho-report-image";
const REPORT_IMAGE_KIND_SYSTEM = "http://fhir-client.local/CodeSystem/patho-report-image-kind";
// 推定病変(細胞診の診断 Observation の component)。
const RESULT_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/patho-result-item";
const CODE_ESTIMATED_LESION = "estimated-lesion";

const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";
const REPORT_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0074";

// Specimen は検体検査・細菌検査の結果と同じ JP Core 共通プロファイル。
const SPECIMEN_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Specimen_Common";

// ---- 選択肢 ----

export interface CodeOption {
  code: string;
  display: string;
}

/**
 * 報告区分。preliminary/final はユーザーが選び、確定後の編集保存で amended に遷移する
 * (遷移は build 側が行うので、フォームの選択肢は中間・最終の 2 つ)。
 */
export type PathoReportStatus = "preliminary" | "final" | "amended";

export const REPORT_STATUS_OPTIONS: { code: "preliminary" | "final"; display: string }[] = [
  { code: "preliminary", display: "中間報告" },
  { code: "final", display: "最終報告" },
];

export function reportStatusDisplay(status: string | undefined): string {
  if (status === "amended") return "修正報告";
  return REPORT_STATUS_OPTIONS.find((o) => o.code === status)?.display ?? "";
}

/** 細胞診の判定。 */
export const CYTO_JUDGEMENT_OPTIONS: CodeOption[] = [
  { code: "negative", display: "陰性" },
  { code: "indeterminate", display: "鑑別困難" },
  { code: "suspicious", display: "悪性疑い" },
  { code: "malignant", display: "悪性" },
  { code: "unsatisfactory", display: "検体不適正" },
];

export function optionDisplay(options: CodeOption[], code: string): string {
  return options.find((o) => o.code === code)?.display ?? code;
}

export function cytoJudgementDisplay(code: string): string {
  return code ? optionDisplay(CYTO_JUDGEMENT_OPTIONS, code) : "";
}

/** レポートに添える画像の種別。表示ではこの順に並べる。 */
export const REPORT_IMAGE_KIND_OPTIONS: CodeOption[] = [
  { code: "gross", display: "肉眼写真" },
  { code: "cutup", display: "切り出し図" },
  { code: "microscopic", display: "鏡検写真" },
  { code: "other", display: "その他" },
];

export function reportImageKindDisplay(code: string): string {
  return code ? optionDisplay(REPORT_IMAGE_KIND_OPTIONS, code) : "";
}

// ---- フォーム値 ----

/** レポートに載せる検体 1 件。臓器・検体タイプはオーダーからの転記。 */
export interface PathoResultSpecimenValues {
  /** 保存済み Specimen の id。新規は undefined。 */
  id?: string;
  organCode: string;
  organName: string;
  typeCode: string;
  typeName: string;
  /** 実際に採取した日("YYYY-MM-DD")。 */
  collectedDate: string;
}

export interface PathoResultFormValues {
  setting: LabResultSetting;
  /** 報告日(レポートの effectiveDateTime)。 */
  reportDate: string;
  /**
   * 検査を行った診療科(Organization)の id。空なら未設定。
   * 病理検査オーダーに紐付ける場合は、オーダーの依頼科をそのまま採用する。
   */
  departmentId: string;
  departmentName: string;
  /**
   * 元になった病理検査オーダー(ヘッダの ServiceRequest)の id。空なら紐付けなし。
   * 「オーダー 1 件 ↔ レポート 1 件」で持つ(検体検査・細菌検査と同じ)。
   */
  orderId: string;
  /** 報告区分。中間のまま保存して、後の編集で最終化できる。 */
  reportStatus: "preliminary" | "final";
  /** 検査区分。診断欄の形(組織診=自由文 / 細胞診=判定+推定病変)を決める。 */
  examCategory: PathoExamCategory;
  /** 検体(オーダーから転記。実採取日だけ結果側で入れ直す)。 */
  specimens: PathoResultSpecimenValues[];
  /** 肉眼所見。空は未入力(Observation を作らない)。 */
  gross: string;
  /** 顕微鏡所見。空は未入力。 */
  microscopic: string;
  /** 診断(組織診・術中迅速の自由文)。 */
  diagnosis: string;
  /** 細胞診の判定。 */
  cytoJudgement: string;
  /** 細胞診の推定病変。 */
  estimatedLesion: string;
  /** 採取法・検体処理法(追加染色など)。空は未入力。 */
  procedureStep: string;
  /** レポートに添える画像(肉眼写真・鏡検写真・切り出し図)。 */
  images: PathoReportImageValues[];
  // 以下は編集時の id 温存用。画面からは触らない。
  grossId?: string;
  microscopicId?: string;
  diagnosisId?: string;
  procedureStepId?: string;
  /** 読み込んだ既存レポートの status。amended への自動遷移の判定に使う。 */
  originalStatus?: PathoReportStatus;
}

/** レポートに添える画像 1 枚。保存済みは binaryId、足したばかりは dataUrl を持つ。 */
export interface PathoReportImageValues {
  /** 保存済み画像の Binary id。まだ保存していなければ空。 */
  binaryId: string;
  /** 添付・描画したばかりの画像(dataURL)。保存済みを読み戻したときは空。 */
  dataUrl: string;
  /** image/png など。読み戻した画像は保存時の値。 */
  contentType: string;
  /** 種別(肉眼写真・切り出し図・鏡検写真・その他)。 */
  kind: string;
  /** 説明。空なら種別名だけをキャプションにする。 */
  caption: string;
}

export function emptyPathoResultSpecimen(): PathoResultSpecimenValues {
  return {
    organCode: "",
    organName: "",
    typeCode: "",
    typeName: "",
    collectedDate: today(),
  };
}

export function emptyPathoResultForm(
  setting: LabResultSetting = "outpatient",
): PathoResultFormValues {
  return {
    setting,
    reportDate: today(),
    departmentId: "",
    departmentName: "",
    orderId: "",
    reportStatus: "final",
    examCategory: "N000",
    specimens: [],
    gross: "",
    microscopic: "",
    diagnosis: "",
    cytoJudgement: "",
    estimatedLesion: "",
    procedureStep: "",
    images: [],
  };
}

/** 画像のキャプション。説明があれば「種別: 説明」、無ければ種別だけ。 */
export function reportImageLabel(image: PathoReportImageValues): string {
  const kind = reportImageKindDisplay(image.kind);
  return [kind, image.caption].filter(Boolean).join(": ");
}

/** 画像を SchemaImageGallery に渡せる形にする(未保存の添付したても出せる)。 */
export function pathoReportImageRefs(images: PathoReportImageValues[]): SchemaImageRef[] {
  return images.map((image, index) => ({
    key: `patho-report-image#${index}`,
    label: reportImageLabel(image),
    binaryId: image.binaryId || null,
    dataUrl: image.dataUrl || null,
  }));
}

/** 種別ごとにまとめた画像。詳細表示で「肉眼写真」「鏡検写真」と並べるのに使う。 */
export function groupReportImagesByKind(
  images: PathoReportImageValues[],
): { kind: string; display: string; images: PathoReportImageValues[] }[] {
  return REPORT_IMAGE_KIND_OPTIONS.flatMap((option) => {
    const members = images.filter((image) => image.kind === option.code);
    return members.length > 0
      ? [{ kind: option.code, display: option.display, images: members }]
      : [];
  });
}

/**
 * 保存後のレポート status。確定(final)・修正済(amended)のレポートを編集保存したら
 * amended に遷移させる(診療記録 clinicalNoteHelpers と同じ規約)。
 */
export function nextReportStatus(values: PathoResultFormValues): PathoReportStatus {
  const original = values.originalStatus;
  return original && original !== "preliminary" ? "amended" : values.reportStatus;
}

/** 保存すると修正報告になるか(フォームで注意書きを出すために使う)。 */
export function willBecomeAmended(values: PathoResultFormValues): boolean {
  return nextReportStatus(values) === "amended";
}

// ---- FHIR リソースの組み立て ----

interface ObservationContext {
  patientId: string;
  effective: string;
  status: PathoReportStatus;
  specimenReferences: fhir4.Reference[];
}

// 所見・診断に共通する Observation の骨格。
function baseObservation(
  ctx: ObservationContext,
  code: fhir4.CodeableConcept,
  id?: string,
): fhir4.Observation {
  const resource: fhir4.Observation = {
    resourceType: "Observation",
    status: ctx.status,
    category: [
      {
        coding: [
          { system: OBSERVATION_CATEGORY_SYSTEM, code: "laboratory", display: "Laboratory" },
        ],
      },
    ],
    code,
    subject: { reference: `Patient/${ctx.patientId}` },
    effectiveDateTime: ctx.effective,
  };
  // Observation.specimen は 0..1。検体が複数ある病理では、どれか 1 つに絞ると
  // 誤解を招くので、1 件のときだけ指す(複数は DiagnosticReport.specimen が持つ)。
  if (ctx.specimenReferences.length === 1) {
    resource.specimen = ctx.specimenReferences[0];
  }
  if (id) resource.id = id;
  return resource;
}

function loincCode(code: string, display: string): fhir4.CodeableConcept {
  return { coding: [{ system: LOINC_SYSTEM, code, display }], text: display };
}

function conceptOf(system: string, code: string, display: string): fhir4.CodeableConcept {
  return { coding: [{ system, code, display }], text: display };
}

// 所見・診断の Observation 群。未入力の所見は Observation を作らない。
function buildFindingObservations(
  values: PathoResultFormValues,
  ctx: ObservationContext,
): { resource: fhir4.Observation; id?: string }[] {
  const findings: { resource: fhir4.Observation; id?: string }[] = [];

  if (values.gross.trim()) {
    const resource = baseObservation(ctx, loincCode(CODE_GROSS, "肉眼所見"), values.grossId);
    resource.valueString = values.gross.trim();
    findings.push({ resource, id: values.grossId });
  }
  if (values.microscopic.trim()) {
    const resource = baseObservation(
      ctx,
      loincCode(CODE_MICROSCOPIC, "顕微鏡所見"),
      values.microscopicId,
    );
    resource.valueString = values.microscopic.trim();
    findings.push({ resource, id: values.microscopicId });
  }

  // 診断。規約でレポートに必須のセクションだが、中間報告の途中保存を止めないため
  // 空なら Observation を作らない(入力必須は画面側で見る)。
  if (isCytologyCategory(values.examCategory)) {
    if (values.cytoJudgement || values.estimatedLesion.trim()) {
      const resource = baseObservation(
        ctx,
        loincCode(CODE_DIAGNOSIS, "診断"),
        values.diagnosisId,
      );
      if (values.cytoJudgement) {
        resource.valueCodeableConcept = conceptOf(
          CYTO_JUDGEMENT_SYSTEM,
          values.cytoJudgement,
          cytoJudgementDisplay(values.cytoJudgement),
        );
      }
      if (values.estimatedLesion.trim()) {
        resource.component = [
          {
            code: {
              coding: [
                { system: RESULT_ITEM_SYSTEM, code: CODE_ESTIMATED_LESION, display: "推定病変" },
              ],
              text: "推定病変",
            },
            valueString: values.estimatedLesion.trim(),
          },
        ];
      }
      findings.push({ resource, id: values.diagnosisId });
    }
  } else if (values.diagnosis.trim()) {
    const resource = baseObservation(ctx, loincCode(CODE_DIAGNOSIS, "診断"), values.diagnosisId);
    resource.valueString = values.diagnosis.trim();
    findings.push({ resource, id: values.diagnosisId });
  }

  if (values.procedureStep.trim()) {
    const resource = baseObservation(
      ctx,
      loincCode(CODE_PROCEDURE_STEP, "採取法／検体処理法"),
      values.procedureStepId,
    );
    resource.valueString = values.procedureStep.trim();
    findings.push({ resource, id: values.procedureStepId });
  }

  return findings;
}

function buildSpecimen(
  specimen: PathoResultSpecimenValues,
  patientId: string,
): fhir4.Specimen {
  const resource: fhir4.Specimen = {
    resourceType: "Specimen",
    meta: { profile: [SPECIMEN_PROFILE] },
    status: "available",
    subject: { reference: `Patient/${patientId}` },
  };
  if (specimen.typeCode) {
    resource.type = {
      coding: [
        {
          system: SPECIMEN_TYPE_SYSTEM,
          code: specimen.typeCode,
          display: specimen.typeName || undefined,
        },
      ],
      text: specimen.typeName || undefined,
    };
  }
  const collection: fhir4.SpecimenCollection = {};
  if (specimen.collectedDate) collection.collectedDateTime = specimen.collectedDate;
  if (specimen.organCode) {
    collection.bodySite = {
      coding: [
        {
          system: ORGAN_SYSTEM,
          code: specimen.organCode,
          display: specimen.organName || undefined,
        },
      ],
      text: specimen.organName || undefined,
    };
  }
  if (collection.collectedDateTime || collection.bodySite) resource.collection = collection;
  if (specimen.id) resource.id = specimen.id;
  return resource;
}

/** レポートに載せる検体の見出し(「胃前庭部（生検）」)。 */
export function resultSpecimenLabel(specimen: PathoResultSpecimenValues): string {
  const name = specimen.organName || "臓器未設定";
  return specimen.typeName ? `${name}（${specimen.typeName}）` : name;
}

/**
 * レポートに添える画像を Bundle に積み、拡張にする参照を返す。足したばかりの画像は
 * Binary を作り、まだ id が無いのでプレースホルダ(urn:uuid)で指す(上流の transaction が
 * 実 ID に書き換える)。保存済みの画像はそのまま参照を引き継ぐ。
 */
function pushReportImageEntries(
  entries: fhir4.BundleEntry[],
  images: PathoReportImageValues[],
): fhir4.Extension[] {
  return images.flatMap((image) => {
    let url: string;
    if (image.binaryId) {
      url = `Binary/${image.binaryId}`;
    } else if (image.dataUrl) {
      const contentType = image.contentType || "image/png";
      const { placeholder, entry } = imageBinaryEntry(image.dataUrl, contentType);
      entries.push(entry);
      url = placeholder;
    } else {
      return [];
    }
    return [
      {
        url: REPORT_IMAGE_EXT_URL,
        extension: [
          {
            url: "kind",
            valueCoding: {
              system: REPORT_IMAGE_KIND_SYSTEM,
              code: image.kind,
              display: reportImageKindDisplay(image.kind),
            },
          },
          {
            url: "image",
            valueAttachment: {
              contentType: image.contentType || "image/png",
              url,
              title: image.caption || undefined,
            },
          },
        ],
      },
    ];
  });
}

function buildPathoResultTransactionBundle(
  values: PathoResultFormValues,
  patientId: string,
  reportId?: string,
  originalObservationIds?: string[],
  originalSpecimenIds?: string[],
): fhir4.Bundle {
  // FHIR の dateTime は日付のみ(YYYY-MM-DD)を許容する(検体検査・細菌検査と同じ)。
  const effective = values.reportDate;
  const status = nextReportStatus(values);
  const reportReference = reportId
    ? `DiagnosticReport/${reportId}`
    : `urn:uuid:${crypto.randomUUID()}`;

  const specimenEntries: fhir4.BundleEntry[] = [];
  const specimenReferences: fhir4.Reference[] = [];
  const keptSpecimenIds = new Set<string>();

  for (const specimen of values.specimens) {
    const fullUrl = specimen.id ? `Specimen/${specimen.id}` : `urn:uuid:${crypto.randomUUID()}`;
    if (specimen.id) keptSpecimenIds.add(specimen.id);
    specimenEntries.push({
      fullUrl,
      resource: buildSpecimen(specimen, patientId),
      request: specimen.id
        ? { method: "PUT", url: `Specimen/${specimen.id}` }
        : { method: "POST", url: "Specimen" },
    });
    specimenReferences.push({ reference: fullUrl, display: resultSpecimenLabel(specimen) });
  }

  const ctx: ObservationContext = {
    patientId,
    effective,
    status,
    specimenReferences,
  };

  // 画像はレポートより先に積む(レポートがプレースホルダで指すため)。
  const imageEntries: fhir4.BundleEntry[] = [];
  const imageExtensions = pushReportImageEntries(imageEntries, values.images);

  const observationEntries: fhir4.BundleEntry[] = [];
  const resultReferences: fhir4.Reference[] = [];
  const keptObservationIds = new Set<string>();

  for (const finding of buildFindingObservations(values, ctx)) {
    const resource = finding.resource;
    const fullUrl = resource.id ? `Observation/${resource.id}` : `urn:uuid:${crypto.randomUUID()}`;
    if (resource.id) keptObservationIds.add(resource.id);
    observationEntries.push({
      fullUrl,
      resource,
      request: resource.id
        ? { method: "PUT", url: `Observation/${resource.id}` }
        : { method: "POST", url: "Observation" },
    });
    resultReferences.push({ reference: fullUrl, display: resource.code.text });
  }

  const report: fhir4.DiagnosticReport = {
    resourceType: "DiagnosticReport",
    status,
    category: [
      {
        coding: [
          isCytologyCategory(values.examCategory)
            ? { system: REPORT_CATEGORY_SYSTEM, code: "CP", display: "Cytopathology" }
            : { system: REPORT_CATEGORY_SYSTEM, code: "SP", display: "Surgical Pathology" },
        ],
      },
      {
        coding: [
          {
            system: SETTING_SYSTEM,
            code: values.setting,
            display: findSettingDisplay(values.setting),
          },
        ],
      },
    ],
    code: {
      coding: [{ system: LOINC_SYSTEM, code: LOINC_PATHO_REPORT_CODE, display: "Pathology study" }],
      text: "病理診断レポート",
    },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: effective,
    // 診療科。DiagnosticReport にも診療科を持つ標準要素が無いため、オーダーの
    // 依頼科と同じローカル拡張で持たせる(検体検査・細菌検査の結果と同じ)。
    extension: [
      ...(values.departmentId
        ? [departmentExtension(values.departmentId, values.departmentName)]
        : []),
      ...imageExtensions,
    ],
    // 元になった病理検査オーダー。オーダーの明細ではなくヘッダを指す。
    basedOn: values.orderId ? [{ reference: `ServiceRequest/${values.orderId}` }] : undefined,
    specimen: specimenReferences.length > 0 ? specimenReferences : undefined,
    result: resultReferences,
  };
  if (reportId) report.id = reportId;

  const removedObservationEntries: fhir4.BundleEntry[] = (originalObservationIds ?? [])
    .filter((id) => !keptObservationIds.has(id))
    .map((id) => ({ request: { method: "DELETE" as const, url: `Observation/${id}` } }));
  const removedSpecimenEntries: fhir4.BundleEntry[] = (originalSpecimenIds ?? [])
    .filter((id) => !keptSpecimenIds.has(id))
    .map((id) => ({ request: { method: "DELETE" as const, url: `Specimen/${id}` } }));

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...imageEntries,
      {
        fullUrl: reportReference,
        resource: report,
        request: reportId
          ? { method: "PUT", url: `DiagnosticReport/${reportId}` }
          : { method: "POST", url: "DiagnosticReport" },
      },
      ...specimenEntries,
      ...observationEntries,
      ...removedObservationEntries,
      // 参照元の Observation を消してから検体を消す。
      ...removedSpecimenEntries,
    ],
  };
}

export function buildPathoResultBundle(
  values: PathoResultFormValues,
  patientId: string,
): fhir4.Bundle {
  return buildPathoResultTransactionBundle(values, patientId);
}

export function buildPathoResultUpdateBundle(
  values: PathoResultFormValues,
  patientId: string,
  reportId: string,
  originalObservationIds: string[],
  originalSpecimenIds: string[],
): fhir4.Bundle {
  return buildPathoResultTransactionBundle(
    values,
    patientId,
    reportId,
    originalObservationIds,
    originalSpecimenIds,
  );
}

export function buildPathoResultDeleteBundle(
  reportId: string,
  observationIds: string[],
  specimenIds: string[],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      { request: { method: "DELETE", url: `DiagnosticReport/${reportId}` } },
      ...observationIds.map((id) => ({
        request: { method: "DELETE" as const, url: `Observation/${id}` },
      })),
      // 参照元の Observation を消してから検体を消す。
      ...specimenIds.map((id) => ({
        request: { method: "DELETE" as const, url: `Specimen/${id}` },
      })),
    ],
  };
}

// ---- 詳細表示のための parse ----

/** DiagnosticReport.basedOn が指す病理検査オーダー(ヘッダ)の id。無ければ空。 */
export function pathoOrderIdFromReport(report: fhir4.DiagnosticReport | undefined): string {
  const reference = report?.basedOn?.find((r) =>
    r.reference?.startsWith("ServiceRequest/"),
  )?.reference;
  return reference?.split("/")[1] ?? "";
}

/** DiagnosticReport が病理診断レポートかどうか(細菌検査などとの振り分け)。 */
export function isPathoReport(report: fhir4.DiagnosticReport): boolean {
  return Boolean(
    report.code?.coding?.some(
      (c) => c.system === LOINC_SYSTEM && c.code === LOINC_PATHO_REPORT_CODE,
    ),
  );
}

export interface PathoResultDetailBundle {
  report?: fhir4.DiagnosticReport;
  observations: fhir4.Observation[];
  specimens: fhir4.Specimen[];
}

export function splitPathoResultDetailBundle(bundle: fhir4.Bundle): PathoResultDetailBundle {
  const result: PathoResultDetailBundle = { observations: [], specimens: [] };
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "DiagnosticReport") {
      result.report = resource as fhir4.DiagnosticReport;
    } else if (resource?.resourceType === "Observation") {
      result.observations.push(resource as fhir4.Observation);
    } else if (resource?.resourceType === "Specimen") {
      result.specimens.push(resource as fhir4.Specimen);
    }
  }

  // include で返る Observation の順序は不定のため、DiagnosticReport.result の
  // 参照順(=登録時の並び: 肉眼所見 → 顕微鏡所見 → 診断 → 採取法)に揃える。
  if (result.report) {
    const order = new Map(observationIdsFromReport(result.report).map((id, i) => [id, i]));
    result.observations.sort(
      (a, b) => (order.get(a.id ?? "") ?? Infinity) - (order.get(b.id ?? "") ?? Infinity),
    );
  }
  return result;
}

function loincCodeOf(obs: fhir4.Observation): string {
  return codingBySystem(obs.code.coding, LOINC_SYSTEM)?.code ?? "";
}

function parseSpecimen(specimen: fhir4.Specimen): PathoResultSpecimenValues {
  const type = codingBySystem(specimen.type?.coding, SPECIMEN_TYPE_SYSTEM);
  const organ = codingBySystem(specimen.collection?.bodySite?.coding, ORGAN_SYSTEM);
  return {
    id: specimen.id,
    organCode: organ?.code ?? "",
    organName: organ?.display ?? specimen.collection?.bodySite?.text ?? "",
    typeCode: type?.code ?? "",
    typeName: type?.display ?? specimen.type?.text ?? "",
    collectedDate: specimen.collection?.collectedDateTime?.slice(0, 10) ?? "",
  };
}

/**
 * レポートの検査区分。レポート自体は組織診/細胞診しか区別しない(category SP/CP)ため、
 * 細胞診は N004、それ以外は N000 に寄せる。術中迅速かどうかは紐付けオーダーで分かる。
 */
export function reportExamCategory(report: fhir4.DiagnosticReport): PathoExamCategory {
  return categoryCoding(report, REPORT_CATEGORY_SYSTEM)?.code === "CP" ? "N004" : "N000";
}

/** レポートに添えられた画像。拡張の並び順(=登録順)をそのまま返す。 */
export function pathoReportImages(
  report: fhir4.DiagnosticReport,
): PathoReportImageValues[] {
  return (report.extension ?? [])
    .filter((e) => e.url === REPORT_IMAGE_EXT_URL)
    .flatMap((e) => {
      const attachment = e.extension?.find((sub) => sub.url === "image")?.valueAttachment;
      const binaryId = binaryIdFromAttachment(attachment);
      if (!binaryId) return [];
      const kind = e.extension?.find((sub) => sub.url === "kind")?.valueCoding?.code ?? "other";
      return [
        {
          binaryId,
          dataUrl: "",
          contentType: attachment?.contentType ?? "image/png",
          kind,
          caption: attachment?.title ?? "",
        },
      ];
    });
}

export function parsePathoResultForm(
  report: fhir4.DiagnosticReport,
  observations: fhir4.Observation[],
  specimens: fhir4.Specimen[] = [],
): PathoResultFormValues {
  const values = emptyPathoResultForm();
  values.setting = (categoryCoding(report, SETTING_SYSTEM)?.code ?? "") as LabResultSetting;
  values.reportDate = report.effectiveDateTime?.slice(0, 10) ?? today();
  const department = departmentOf(report);
  values.departmentId = department.departmentId;
  values.departmentName = department.departmentName;
  values.orderId = pathoOrderIdFromReport(report);
  // 修正報告は最終報告として編集を続ける(次の保存でまた amended になる)。
  values.reportStatus = report.status === "preliminary" ? "preliminary" : "final";
  values.originalStatus = report.status as PathoReportStatus;
  values.examCategory = reportExamCategory(report);
  values.specimens = specimens.map(parseSpecimen);
  values.images = pathoReportImages(report);

  for (const obs of observations) {
    switch (loincCodeOf(obs)) {
      case CODE_GROSS:
        values.gross = obs.valueString ?? "";
        values.grossId = obs.id;
        break;
      case CODE_MICROSCOPIC:
        values.microscopic = obs.valueString ?? "";
        values.microscopicId = obs.id;
        break;
      case CODE_DIAGNOSIS: {
        values.diagnosisId = obs.id;
        // 組織診は自由文、細胞診は判定 + 推定病変。どちらの形で保存されていても
        // 読めるように両方を復元する。
        values.diagnosis = obs.valueString ?? "";
        values.cytoJudgement =
          codingBySystem(obs.valueCodeableConcept?.coding, CYTO_JUDGEMENT_SYSTEM)?.code ?? "";
        values.estimatedLesion =
          obs.component?.find(
            (c) =>
              codingBySystem(c.code.coding, RESULT_ITEM_SYSTEM)?.code === CODE_ESTIMATED_LESION,
          )?.valueString ?? "";
        break;
      }
      case CODE_PROCEDURE_STEP:
        values.procedureStep = obs.valueString ?? "";
        values.procedureStepId = obs.id;
        break;
    }
  }
  return values;
}

/** レポートの 1 行要約(一覧・カルテカード用)。診断があれば診断、無ければ所見の頭。 */
export function pathoResultSummary(values: PathoResultFormValues): string {
  if (isCytologyCategory(values.examCategory)) {
    return [cytoJudgementDisplay(values.cytoJudgement), values.estimatedLesion]
      .filter(Boolean)
      .join(" / ");
  }
  return values.diagnosis || values.microscopic || values.gross;
}
