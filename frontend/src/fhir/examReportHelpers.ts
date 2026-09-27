import { nowFhirDateTime } from "../lib/dates";
import {
  endoscopyOrderItems,
  entryLabel as endoscopyEntryLabel,
  orderEntries as endoscopyOrderEntries,
  summarizeEndoscopyOrder,
} from "./endoscopyOrderHelpers";
import { isEndoscopyProcedure } from "./endoscopyResultHelpers";
import { SETTING_SYSTEM, type LabResultSetting } from "./labResultHelpers";
import {
  entryLabel as physioEntryLabel,
  orderEntries as physioOrderEntries,
  physioOrderItems,
  summarizePhysioOrder,
} from "./physioOrderHelpers";
import { isPhysioProcedure } from "./physioResultHelpers";
import {
  departmentExtension,
  departmentOf,
  ORDER_TYPE_SYSTEM,
  prescriptionRequester,
} from "./prescriptionHelpers";
import type { SchemaImageRef, TemplateBinding } from "./questionnaireResponseHelpers";
import {
  entryLabel as radEntryLabel,
  orderEntries as radOrderEntries,
  radOrderItems,
  summarizeRadOrder,
} from "./radOrderHelpers";
import { isRadProcedure } from "./radResultHelpers";
import { binaryIdFromAttachment, imageBinaryEntry, newBinaryDataLength } from "./schemaImage";
import { categoryCoding, codingBySystem, findSettingDisplay } from "./shared";

// 検査レポート(docs/exam-report-design.md)。放射線の読影レポート・生理検査の所見レポート・
// 内視鏡の所見レポートで共通の形。
//
//   DiagnosticReport ─ basedOn → オーダー(ヘッダ ServiceRequest)
//     ├ result → Observation(所見)
//     └ extension[<接頭辞>-report-image] → Binary(元画像・描き込み画像)
//
// を 1 本の transaction Bundle で保存する。種別ごとに違うのは category・code・拡張の接頭辞・
// 画面の文言だけで、それを ExamReportConfig に持つ。
//
// 記載医は resultsInterpreter、診断は conclusion、発行施設は performer。
// 報告区分は 暫定(preliminary)→ 最終(final)→ 確定後の編集で訂正(amended)。
// 所見の訂正は解釈を改めることなので、検体検査の corrected ではなく病理と同じ amended。

// ---- コードシステム ----

const LOINC_SYSTEM = "http://loinc.org";
const DOCUMENT_CODES_SYSTEM = "http://jpfhir.jp/fhir/core/CodeSystem/JP_DocumentCodes_CS";
const V2_0074_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0074";
const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";
/** 生理検査の報告書の code。種別の幅が広く(心電図・超音波・呼吸機能…)1 つの LOINC に収まらない。 */
const EXAM_REPORT_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/exam-report";
const EXTENSION_BASE = "http://fhir-client.local/StructureDefinition/";
const FINDINGS_CODE = "findings";

// ---- 種別ごとの設定 ----

export type ExamReportKind = "rad" | "physio" | "endoscopy";

export interface ExamReportConfig {
  kind: ExamReportKind;
  /** 種別を判定する category の coding。`DiagnosticReport?category=` の検索にも使う。 */
  kindCoding: fhir4.Coding;
  /** v2-0074 の診断区分。検体検査・細菌・病理の結果一覧(LAB / MB / SP,CP)と混ざらない値にする。 */
  sectionCoding: fhir4.Coding;
  code: fhir4.Coding;
  observationCategory: fhir4.Coding;
  /** 拡張の URL と所見 Observation の code system の接頭辞。 */
  prefix: string;
  labels: {
    /** 「読影レポート」「所見レポート」 */
    report: string;
    /** 入力欄の見出しと一覧のボタン(「読影」「所見」)。 */
    action: string;
    /** 検査の呼び方(「撮影」「検査」)。「撮影内容」「撮影日時」のように使う。 */
    exam: string;
    interpreter: string;
    conclusion: string;
    /** 検査そのものの名前(「放射線検査」「生理検査」「内視鏡」)。 */
    order: string;
  };
  critical: {
    taskCode: { code: string; display: string };
    /** 通知一覧の種別の表示。放射線は Task.code の display が「重要所見」のままなので分けて持つ。 */
    label: string;
  };
  /** 描き込みの色を暗い画像向け(黄・赤・水色・白)にするか。 */
  darkImages: boolean;
  /** カルテの詳細モーダルの種別(karteUrl の KarteDetailKind)。 */
  detailKind: "rad-result" | "physio-result" | "endoscopy-result";
  settingOf(order: fhir4.ServiceRequest): string;
  examText(order: fhir4.ServiceRequest, itemRequests: fhir4.ServiceRequest[]): string;
  isProcedure(procedure: fhir4.Procedure): boolean;
}

const RAD_CONFIG: ExamReportConfig = {
  kind: "rad",
  // JP Core の JP_DiagnosticReport_Radiology が固定スライスで求める値。
  kindCoding: { system: LOINC_SYSTEM, code: "LP29684-5", display: "Radiology" },
  sectionCoding: { system: V2_0074_SYSTEM, code: "RAD", display: "Radiology" },
  code: { system: DOCUMENT_CODES_SYSTEM, code: "18748-4", display: "画像検査報告書" },
  observationCategory: { system: OBSERVATION_CATEGORY_SYSTEM, code: "imaging", display: "Imaging" },
  prefix: "rad",
  labels: {
    report: "読影レポート",
    action: "読影",
    exam: "撮影",
    interpreter: "読影医",
    conclusion: "診断",
    order: "放射線検査",
  },
  critical: {
    taskCode: { code: "rad-critical-finding", display: "重要所見" },
    label: "重要所見(放射線)",
  },
  darkImages: true,
  detailKind: "rad-result",
  settingOf: (order) => summarizeRadOrder(order).settingCode,
  examText: (order, itemRequests) =>
    radOrderEntries(radOrderItems(order, itemRequests)).map(radEntryLabel).join("・"),
  isProcedure: isRadProcedure,
};

const PHYSIO_CONFIG: ExamReportConfig = {
  kind: "physio",
  kindCoding: { system: ORDER_TYPE_SYSTEM, code: "physio", display: "生理検査" },
  sectionCoding: { system: V2_0074_SYSTEM, code: "OTH", display: "Other" },
  code: { system: EXAM_REPORT_CODE_SYSTEM, code: "physio", display: "生理検査報告書" },
  observationCategory: { system: OBSERVATION_CATEGORY_SYSTEM, code: "procedure", display: "Procedure" },
  prefix: "physio",
  labels: {
    report: "所見レポート",
    action: "所見",
    exam: "検査",
    interpreter: "記載医",
    conclusion: "判定",
    order: "生理検査",
  },
  critical: {
    taskCode: { code: "physio-critical-finding", display: "重要所見(生理検査)" },
    label: "重要所見(生理検査)",
  },
  darkImages: false,
  detailKind: "physio-result",
  settingOf: (order) => summarizePhysioOrder(order).settingCode,
  examText: (order, itemRequests) =>
    physioOrderEntries(physioOrderItems(order, itemRequests)).map(physioEntryLabel).join("・"),
  isProcedure: isPhysioProcedure,
};

const ENDOSCOPY_CONFIG: ExamReportConfig = {
  kind: "endoscopy",
  kindCoding: { system: ORDER_TYPE_SYSTEM, code: "endoscopy", display: "内視鏡" },
  sectionCoding: { system: V2_0074_SYSTEM, code: "OTH", display: "Other" },
  code: { system: LOINC_SYSTEM, code: "18751-8", display: "Endoscopy study" },
  observationCategory: { system: OBSERVATION_CATEGORY_SYSTEM, code: "procedure", display: "Procedure" },
  prefix: "endoscopy",
  labels: {
    report: "所見レポート",
    action: "所見",
    exam: "検査",
    interpreter: "記載医",
    conclusion: "診断",
    order: "内視鏡",
  },
  critical: {
    taskCode: { code: "endoscopy-critical-finding", display: "重要所見(内視鏡)" },
    label: "重要所見(内視鏡)",
  },
  // 内視鏡の画像は暗い背景に粘膜が写るので、放射線と同じ明るい色が見やすい。
  darkImages: true,
  detailKind: "endoscopy-result",
  settingOf: (order) => summarizeEndoscopyOrder(order).settingCode,
  examText: (order, itemRequests) =>
    endoscopyOrderEntries(endoscopyOrderItems(order, itemRequests))
      .map(endoscopyEntryLabel)
      .join("・"),
  isProcedure: isEndoscopyProcedure,
};

export const EXAM_REPORT_CONFIGS: Record<ExamReportKind, ExamReportConfig> = {
  rad: RAD_CONFIG,
  physio: PHYSIO_CONFIG,
  endoscopy: ENDOSCOPY_CONFIG,
};

export const EXAM_REPORT_KINDS = Object.values(EXAM_REPORT_CONFIGS);

/** カルテのオーダーの種別 → レポートの種別。 */
export const EXAM_REPORT_KIND_OF_ORDER = {
  "rad-order": "rad",
  "physio-order": "physio",
  "endoscopy-order": "endoscopy",
} as const satisfies Record<string, ExamReportKind>;

/** 種別の文字列(検査結果確認の通知の種別など)から設定を引く。検査レポート以外は undefined。 */
export function examReportConfigByKind(kind: string): ExamReportConfig | undefined {
  return EXAM_REPORT_KINDS.find((config) => config.kind === kind);
}

/** `DiagnosticReport?category=` で種別を引くときの token。 */
export function examReportCategorySearch(config: ExamReportConfig): string {
  return `${config.kindCoding.system}|${config.kindCoding.code}`;
}

function extensionUrl(config: ExamReportConfig, name: string): string {
  return `${EXTENSION_BASE}${config.prefix}-${name}`;
}

/**
 * 画像 1 枚。元画像(source)と描き込みの合成画像(annotated)を別の Binary で持つ。
 * 描き込みモーダルは合成画像しか返さないので、元画像を残さないと描き直せなくなる。
 * DiagnosticReport.media は Reference(Media) を要求するが、上流に Media が無いので拡張にする。
 */
const imageExtUrl = (config: ExamReportConfig) => extensionUrl(config, "report-image");
/** 重要所見の要点。あれば依頼医あてにアラートの通知を出す(examCriticalFindingHelpers)。 */
const criticalFindingExtUrl = (config: ExamReportConfig) => extensionUrl(config, "critical-finding");
/** 所見・診断をテンプレートから記載したときの記入内容(QuestionnaireResponse)への参照。 */
const findingsQrExtUrl = (config: ExamReportConfig) => extensionUrl(config, "report-findings-response");
const conclusionQrExtUrl = (config: ExamReportConfig) =>
  extensionUrl(config, "report-conclusion-response");
/** 所見 Observation の code。JP Core に決まりが無いのでローカルコードにする。 */
const reportItemSystem = (config: ExamReportConfig) =>
  `http://fhir-client.local/CodeSystem/${config.prefix}-report-item`;

/**
 * 1 回の保存で新しく送る画像(base64)の合計の上限。上流は本文が 10MB を超えると 413 で
 * 拒否するので、本文・テンプレート回答の余白を残した値にする。保存済みの画像は参照だけで
 * 再送しないので、分けて保存すれば枚数の制限にはならない。
 */
export const EXAM_REPORT_MAX_NEW_IMAGE_LENGTH = 7 * 1024 * 1024;

export const EXAM_REPORT_TOO_LARGE_MESSAGE =
  "一度に添付できる画像の量を超えています。いったん保存してから追加してください。";

// ---- 報告区分 ----

export type ExamReportStatus = "preliminary" | "final" | "amended";

/** 画面で選べるのは暫定と最終。訂正は確定後の編集保存で自動的に付く。 */
export const EXAM_REPORT_STATUS_OPTIONS: { code: "preliminary" | "final"; display: string }[] = [
  { code: "preliminary", display: "暫定報告" },
  { code: "final", display: "最終報告" },
];

export function examReportStatusDisplay(status: string | undefined): string {
  if (status === "amended") return "訂正報告";
  return EXAM_REPORT_STATUS_OPTIONS.find((o) => o.code === status)?.display ?? "";
}

// ---- フォーム値 ----

/** 画像の実体。保存済みは binaryId、足したばかりは dataUrl を持つ。 */
export interface ExamReportImageData {
  binaryId: string;
  dataUrl: string;
  contentType: string;
}

export interface ExamReportImageValues {
  source: ExamReportImageData;
  /** 描き込みの合成画像。描き込みが無ければ null。 */
  annotated: ExamReportImageData | null;
  caption: string;
}

export interface ExamReportFormValues {
  orderId: string;
  setting: LabResultSetting;
  departmentId: string;
  departmentName: string;
  /** 検査日時。実施記録の performedDateTime、無ければオーダーの occurrenceDateTime。 */
  effectiveDateTime: string;
  /** 検査内容(code.text)。オーダーの GP の見出しを並べたもの。 */
  examText: string;
  reportStatus: "preliminary" | "final";
  findings: string;
  findingsTemplate: TemplateBinding | null;
  conclusion: string;
  conclusionTemplate: TemplateBinding | null;
  criticalFinding: boolean;
  criticalFindingText: string;
  images: ExamReportImageValues[];
  /** 記載医。保存時にログイン中の医療従事者を入れ、編集では最初の記載医を残す。 */
  interpreterId: string;
  interpreterName: string;
  organizationId: string;
  organizationName: string;
  /** 以下は編集時の復元用。 */
  findingsId?: string;
  originalStatus?: ExamReportStatus;
}

/**
 * 実施記録から検査日時を取る。取消 → 再実施でハブが複数残ることがあるので最も新しいもの。
 * 実施入力をしない項目では実施記録が無いので空を返す(呼び出し側がオーダーの日時で補う)。
 */
export function examPerformedDateTime(
  config: ExamReportConfig,
  procedures: fhir4.Procedure[],
): string {
  return procedures
    .filter(
      (p) =>
        config.isProcedure(p) &&
        !p.partOf?.length &&
        p.status !== "entered-in-error" &&
        Boolean(p.performedDateTime),
    )
    .map((p) => p.performedDateTime as string)
    .sort()
    .pop() ?? "";
}

export function emptyExamReportForm(
  config: ExamReportConfig,
  order: fhir4.ServiceRequest,
  itemRequests: fhir4.ServiceRequest[],
  procedures: fhir4.Procedure[],
): ExamReportFormValues {
  const requester = prescriptionRequester(order);
  return {
    orderId: order.id ?? "",
    setting: (config.settingOf(order) || "outpatient") as LabResultSetting,
    departmentId: requester.departmentId,
    departmentName: requester.departmentName,
    effectiveDateTime: examPerformedDateTime(config, procedures) || order.occurrenceDateTime || "",
    examText: config.examText(order, itemRequests),
    reportStatus: "final",
    findings: "",
    findingsTemplate: null,
    conclusion: "",
    conclusionTemplate: null,
    criticalFinding: false,
    criticalFindingText: "",
    images: [],
    interpreterId: "",
    interpreterName: "",
    organizationId: "",
    organizationName: "",
  };
}

/** 保存後の status。確定(final・amended)のレポートを編集保存したら amended にする。 */
export function nextExamReportStatus(values: ExamReportFormValues): ExamReportStatus {
  const original = values.originalStatus;
  return original && original !== "preliminary" ? "amended" : values.reportStatus;
}

export function willBecomeAmended(values: ExamReportFormValues): boolean {
  return nextExamReportStatus(values) === "amended";
}

/** 表示する画像(描き込みがあればそれ)。 */
export function displayedImage(image: ExamReportImageValues): ExamReportImageData {
  return image.annotated ?? image.source;
}

/** SchemaImageGallery に渡す形。表示は描き込みがあれば描き込み画像。 */
export function examReportImageRefs(images: ExamReportImageValues[]): SchemaImageRef[] {
  return images.map((image, index) => {
    const shown = displayedImage(image);
    return {
      key: `exam-report-image#${index}`,
      label: image.caption,
      binaryId: shown.binaryId || null,
      dataUrl: shown.dataUrl || null,
    };
  });
}

/** 拡大表示(ReportImageViewerModal)に渡す形。描き込みがあれば元画像と切り替えられる。 */
export function examReportViewerImages(images: ExamReportImageValues[]) {
  const dataOf = (data: ExamReportImageData) => ({
    binaryId: data.binaryId || null,
    dataUrl: data.dataUrl || null,
  });
  return images.map((image, index) => ({
    key: `exam-report-image#${index}`,
    caption: image.caption,
    image: dataOf(displayedImage(image)),
    original: image.annotated ? dataOf(image.source) : null,
  }));
}

// ---- FHIR リソースの組み立て ----

/** 画像の実体を Bundle に積み、拡張に書く参照を返す。 */
function imageReference(entries: fhir4.BundleEntry[], image: ExamReportImageData): string | null {
  if (image.binaryId) return `Binary/${image.binaryId}`;
  if (!image.dataUrl) return null;
  const { placeholder, entry } = imageBinaryEntry(image.dataUrl, image.contentType || "image/jpeg");
  entries.push(entry);
  return placeholder;
}

function pushImageEntries(
  config: ExamReportConfig,
  entries: fhir4.BundleEntry[],
  images: ExamReportImageValues[],
): fhir4.Extension[] {
  return images.flatMap((image) => {
    const sourceUrl = imageReference(entries, image.source);
    if (!sourceUrl) return [];
    const annotatedUrl = image.annotated ? imageReference(entries, image.annotated) : null;
    const extension: fhir4.Extension[] = [
      {
        url: "source",
        valueAttachment: {
          contentType: image.source.contentType || "image/jpeg",
          url: sourceUrl,
          title: image.caption || undefined,
        },
      },
    ];
    if (image.annotated && annotatedUrl) {
      extension.push({
        url: "annotated",
        valueAttachment: {
          contentType: image.annotated.contentType || "image/jpeg",
          url: annotatedUrl,
        },
      });
    }
    return [{ url: imageExtUrl(config), extension }];
  });
}

/**
 * テンプレートの記入内容を Bundle に積み、レポートから指す参照を返す。
 * 保存済みの回答を再編集していなければ参照だけ引き継ぐ(オーダーの検査目的と同じ形)。
 */
function templateReference(
  entries: fhir4.BundleEntry[],
  keptResponseIds: Set<string>,
  binding: TemplateBinding | null,
): string {
  if (!binding) return "";
  const { responseId, draft } = binding;
  if (!draft) {
    if (!responseId) return "";
    keptResponseIds.add(responseId);
    return `QuestionnaireResponse/${responseId}`;
  }
  const reference = responseId
    ? `QuestionnaireResponse/${responseId}`
    : `urn:uuid:${crypto.randomUUID()}`;
  if (responseId) {
    keptResponseIds.add(responseId);
    entries.push({
      resource: { ...draft.response, id: responseId },
      request: { method: "PUT", url: reference },
    });
  } else {
    entries.push({
      fullUrl: reference,
      resource: draft.response,
      request: { method: "POST", url: "QuestionnaireResponse" },
    });
  }
  entries.push(...draft.imageEntries);
  return reference;
}

export interface ExamReportSaveTarget {
  reportId?: string;
  /** 編集前のレポートが参照していた所見 Observation とテンプレート回答。外れたものを消す。 */
  originalObservationIds?: string[];
  originalResponseIds?: string[];
}

export function buildExamReportBundle(
  config: ExamReportConfig,
  values: ExamReportFormValues,
  patientId: string,
  { reportId, originalObservationIds = [], originalResponseIds = [] }: ExamReportSaveTarget = {},
): fhir4.Bundle {
  const status = nextExamReportStatus(values);
  const reportReference = reportId ? `DiagnosticReport/${reportId}` : `urn:uuid:${crypto.randomUUID()}`;

  // 画像とテンプレート回答はレポートが参照するので、レポートより先に積む。
  const leadingEntries: fhir4.BundleEntry[] = [];
  const imageExtensions = pushImageEntries(config, leadingEntries, values.images);
  const keptResponseIds = new Set<string>();
  const findingsResponse = templateReference(leadingEntries, keptResponseIds, values.findingsTemplate);
  const conclusionResponse = templateReference(
    leadingEntries,
    keptResponseIds,
    values.conclusionTemplate,
  );

  const observationEntries: fhir4.BundleEntry[] = [];
  const resultReferences: fhir4.Reference[] = [];
  const keptObservationIds = new Set<string>();
  if (values.findings.trim()) {
    const observation: fhir4.Observation = {
      resourceType: "Observation",
      status,
      category: [{ coding: [config.observationCategory] }],
      code: {
        coding: [{ system: reportItemSystem(config), code: FINDINGS_CODE, display: "所見" }],
        text: "所見",
      },
      subject: { reference: `Patient/${patientId}` },
      ...(values.effectiveDateTime ? { effectiveDateTime: values.effectiveDateTime } : {}),
      valueString: values.findings,
    };
    const fullUrl = values.findingsId
      ? `Observation/${values.findingsId}`
      : `urn:uuid:${crypto.randomUUID()}`;
    if (values.findingsId) {
      observation.id = values.findingsId;
      keptObservationIds.add(values.findingsId);
    }
    observationEntries.push({
      fullUrl,
      resource: observation,
      request: values.findingsId
        ? { method: "PUT", url: `Observation/${values.findingsId}` }
        : { method: "POST", url: "Observation" },
    });
    resultReferences.push({ reference: fullUrl, display: "所見" });
  }

  const extension: fhir4.Extension[] = [
    ...(values.departmentId ? [departmentExtension(values.departmentId, values.departmentName)] : []),
    ...imageExtensions,
    ...(values.criticalFinding && values.criticalFindingText.trim()
      ? [{ url: criticalFindingExtUrl(config), valueString: values.criticalFindingText.trim() }]
      : []),
    ...(findingsResponse
      ? [{ url: findingsQrExtUrl(config), valueReference: { reference: findingsResponse } }]
      : []),
    ...(conclusionResponse
      ? [{ url: conclusionQrExtUrl(config), valueReference: { reference: conclusionResponse } }]
      : []),
  ];

  const report: fhir4.DiagnosticReport = {
    resourceType: "DiagnosticReport",
    ...(extension.length > 0 ? { extension } : {}),
    basedOn: [{ reference: `ServiceRequest/${values.orderId}` }],
    status,
    category: [
      { coding: [config.kindCoding] },
      { coding: [config.sectionCoding] },
      {
        coding: [
          { system: SETTING_SYSTEM, code: values.setting, display: findSettingDisplay(values.setting) },
        ],
      },
    ],
    code: {
      coding: [config.code],
      text: values.examText || config.code.display,
    },
    subject: { reference: `Patient/${patientId}` },
    ...(values.effectiveDateTime ? { effectiveDateTime: values.effectiveDateTime } : {}),
    // 報告日時。保存のたびに更新するので、訂正した時刻が残る。
    issued: nowFhirDateTime(),
    ...(values.organizationId
      ? {
          performer: [
            {
              reference: `Organization/${values.organizationId}`,
              display: values.organizationName || undefined,
            },
          ],
        }
      : {}),
    ...(values.interpreterId
      ? {
          resultsInterpreter: [
            {
              reference: `Practitioner/${values.interpreterId}`,
              display: values.interpreterName || undefined,
            },
          ],
        }
      : {}),
    ...(resultReferences.length > 0 ? { result: resultReferences } : {}),
    ...(values.conclusion.trim() ? { conclusion: values.conclusion } : {}),
  };
  if (reportId) report.id = reportId;

  const removedEntries: fhir4.BundleEntry[] = [
    ...originalObservationIds
      .filter((id) => !keptObservationIds.has(id))
      .map((id) => ({ request: { method: "DELETE" as const, url: `Observation/${id}` } })),
    ...originalResponseIds
      .filter((id) => !keptResponseIds.has(id))
      .map((id) => ({ request: { method: "DELETE" as const, url: `QuestionnaireResponse/${id}` } })),
  ];

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...leadingEntries,
      {
        fullUrl: reportReference,
        resource: report,
        request: reportId
          ? { method: "PUT", url: `DiagnosticReport/${reportId}` }
          : { method: "POST", url: "DiagnosticReport" },
      },
      ...observationEntries,
      ...removedEntries,
    ],
  };
}

/** 新しく送る画像の量が上限を超えていないか。超えていれば保存させない。 */
export function examReportBundleTooLarge(bundle: fhir4.Bundle): boolean {
  return newBinaryDataLength(bundle.entry ?? []) > EXAM_REPORT_MAX_NEW_IMAGE_LENGTH;
}

/**
 * レポートの削除。所見とテンプレート回答も消す。画像の Binary は消さない
 * (上流の旧版が参照しているため。readme「シェーマ画像」)。
 */
export function buildExamReportDeleteEntries(
  config: ExamReportConfig,
  report: fhir4.DiagnosticReport,
): fhir4.BundleEntry[] {
  return [
    { request: { method: "DELETE", url: `DiagnosticReport/${report.id}` } },
    ...examReportObservationIds(report).map((id) => ({
      request: { method: "DELETE" as const, url: `Observation/${id}` },
    })),
    ...examReportResponseIds(config, report).map((id) => ({
      request: { method: "DELETE" as const, url: `QuestionnaireResponse/${id}` },
    })),
  ];
}

// ---- 読み戻し ----

/** その種別のレポートか。 */
export function isExamReport(config: ExamReportConfig, report: fhir4.DiagnosticReport): boolean {
  const { system, code } = config.kindCoding;
  return Boolean(
    report.category?.some((category) =>
      category.coding?.some((c) => c.system === system && c.code === code),
    ),
  );
}

/** 3 種のどれのレポートか。どれでもなければ undefined。 */
export function examReportConfigOf(report: fhir4.DiagnosticReport): ExamReportConfig | undefined {
  return EXAM_REPORT_KINDS.find((config) => isExamReport(config, report));
}

export function examReportObservationIds(report: fhir4.DiagnosticReport): string[] {
  return (report.result ?? [])
    .map((reference) => reference.reference?.match(/^Observation\/(.+)$/)?.[1])
    .filter((id): id is string => Boolean(id));
}

function responseIdOf(report: fhir4.DiagnosticReport, url: string): string | null {
  const reference = report.extension?.find((e) => e.url === url)?.valueReference?.reference;
  return reference?.match(/^QuestionnaireResponse\/(.+)$/)?.[1] ?? null;
}

export function examReportResponseIds(
  config: ExamReportConfig,
  report: fhir4.DiagnosticReport,
): string[] {
  return [
    responseIdOf(report, findingsQrExtUrl(config)),
    responseIdOf(report, conclusionQrExtUrl(config)),
  ].filter((id): id is string => Boolean(id));
}

/** 重要所見の要点。無ければ空。 */
export function examCriticalFindingOf(
  config: ExamReportConfig,
  report: fhir4.DiagnosticReport,
): string {
  return report.extension?.find((e) => e.url === criticalFindingExtUrl(config))?.valueString ?? "";
}

function imageDataOf(attachment: fhir4.Attachment | undefined): ExamReportImageData | null {
  const binaryId = binaryIdFromAttachment(attachment);
  if (!binaryId) return null;
  return { binaryId, dataUrl: "", contentType: attachment?.contentType ?? "image/jpeg" };
}

/** 添付画像。拡張の並び順が表示順。 */
export function examReportImages(
  config: ExamReportConfig,
  report: fhir4.DiagnosticReport,
): ExamReportImageValues[] {
  return (report.extension ?? [])
    .filter((e) => e.url === imageExtUrl(config))
    .flatMap((e) => {
      const sourceAttachment = e.extension?.find((sub) => sub.url === "source")?.valueAttachment;
      const source = imageDataOf(sourceAttachment);
      if (!source) return [];
      const annotated = imageDataOf(
        e.extension?.find((sub) => sub.url === "annotated")?.valueAttachment,
      );
      return [{ source, annotated, caption: sourceAttachment?.title ?? "" }];
    });
}

export interface ExamReportDetail {
  report?: fhir4.DiagnosticReport;
  observations: fhir4.Observation[];
}

/** `_include=DiagnosticReport:result` の応答を分ける。 */
export function splitExamReportBundle(
  config: ExamReportConfig,
  bundle: fhir4.Bundle | undefined,
): ExamReportDetail {
  const result: ExamReportDetail = { observations: [] };
  for (const entry of bundle?.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "DiagnosticReport") {
      const report = resource as fhir4.DiagnosticReport;
      if (!result.report && isExamReport(config, report)) result.report = report;
    } else if (resource?.resourceType === "Observation") {
      result.observations.push(resource as fhir4.Observation);
    }
  }
  return result;
}

function referenceOf(references: fhir4.Reference[] | undefined, type: string) {
  const reference = references?.find((r) => r.reference?.startsWith(`${type}/`));
  return { id: reference?.reference?.split("/")[1] ?? "", display: reference?.display ?? "" };
}

export function parseExamReportForm(
  config: ExamReportConfig,
  report: fhir4.DiagnosticReport,
  observations: fhir4.Observation[],
): ExamReportFormValues {
  const findings = observations.find(
    (o) => codingBySystem(o.code.coding, reportItemSystem(config))?.code === FINDINGS_CODE,
  );
  const department = departmentOf(report);
  const interpreter = referenceOf(report.resultsInterpreter, "Practitioner");
  const organization = referenceOf(report.performer, "Organization");
  const criticalFindingText = examCriticalFindingOf(config, report);
  const findingsResponseId = responseIdOf(report, findingsQrExtUrl(config));
  const conclusionResponseId = responseIdOf(report, conclusionQrExtUrl(config));

  return {
    orderId: referenceOf(report.basedOn, "ServiceRequest").id,
    setting: (categoryCoding(report, SETTING_SYSTEM)?.code ?? "") as LabResultSetting,
    departmentId: department.departmentId,
    departmentName: department.departmentName,
    effectiveDateTime: report.effectiveDateTime ?? "",
    examText: report.code?.text ?? "",
    // 訂正報告は最終報告として編集を続ける(次の保存でまた amended になる)。
    reportStatus: report.status === "preliminary" ? "preliminary" : "final",
    originalStatus: report.status as ExamReportStatus,
    findings: findings?.valueString ?? "",
    findingsId: findings?.id,
    findingsTemplate: findingsResponseId ? { responseId: findingsResponseId, draft: null } : null,
    conclusion: report.conclusion ?? "",
    conclusionTemplate: conclusionResponseId
      ? { responseId: conclusionResponseId, draft: null }
      : null,
    criticalFinding: Boolean(criticalFindingText),
    criticalFindingText,
    images: examReportImages(config, report),
    interpreterId: interpreter.id,
    interpreterName: interpreter.display,
    organizationId: organization.id,
    organizationName: organization.display,
  };
}

/** 検査日時・報告日時の表示("YYYY-MM-DD HH:mm"。日付だけのものは日付)。 */
export function examReportDateTimeLabel(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 10) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16).replace("T", " ");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
