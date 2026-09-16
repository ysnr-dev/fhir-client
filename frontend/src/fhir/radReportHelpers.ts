import { nowFhirDateTime } from "../lib/dates";
import { SETTING_SYSTEM, type LabResultSetting } from "./labResultHelpers";
import { departmentExtension, departmentOf, prescriptionRequester } from "./prescriptionHelpers";
import type { SchemaImageRef, TemplateBinding } from "./questionnaireResponseHelpers";
import {
  entryLabel,
  orderEntries,
  radOrderItems,
  summarizeRadOrder,
} from "./radOrderHelpers";
import { isRadProcedure } from "./radResultHelpers";
import { binaryIdFromAttachment, imageBinaryEntry, newBinaryDataLength } from "./schemaImage";
import { categoryCoding, codingBySystem, findSettingDisplay } from "./shared";

// 放射線検査の読影レポート(docs/rad-report-design.md)。
//
//   DiagnosticReport ─ basedOn → 放射線オーダー(ヘッダ ServiceRequest)
//     ├ result → Observation(所見)
//     └ extension[rad-report-image] → Binary(元画像・描き込み画像)
//
// を 1 本の transaction Bundle で保存する。
//
// 要素の入れ方は JP Core の JP_DiagnosticReport_Radiology に合わせる。category は LOINC の
// LP29684-5、code は JP_DocumentCodes_CS の 18748-4(画像検査報告書)、読影医は
// resultsInterpreter、診断は conclusion。上流の登録先は JP_DiagnosticReport_Common なので
// meta.profile は付けない。
//
// 報告区分は 暫定(preliminary)→ 最終(final)→ 確定後の編集で訂正(amended)。
// 読影の訂正は解釈を改めることなので、検体検査の corrected ではなく病理と同じ amended。

// ---- コードシステム・拡張 ----

const LOINC_SYSTEM = "http://loinc.org";
const RADIOLOGY_CATEGORY_CODE = "LP29684-5";
const DOCUMENT_CODES_SYSTEM = "http://jpfhir.jp/fhir/core/CodeSystem/JP_DocumentCodes_CS";
const RADIOLOGY_REPORT_CODE = "18748-4";
const REPORT_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0074";
const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";

// 所見 Observation の code。JP Core は放射線の result を定めていないのでローカルコードにする。
const REPORT_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/rad-report-item";
const FINDINGS_CODE = "findings";

/**
 * 画像 1 枚。元画像(source)と描き込みの合成画像(annotated)を別の Binary で持つ。
 * 描き込みモーダルは合成画像しか返さないので、元画像を残さないと描き直せなくなる。
 * DiagnosticReport.media は Reference(Media) を要求するが、上流に Media が無いので拡張にする。
 */
const REPORT_IMAGE_EXT_URL = "http://fhir-client.local/StructureDefinition/rad-report-image";
/** 重要所見の要点。あれば依頼医あてにアラートの通知を出す(radCriticalFindingHelpers)。 */
const CRITICAL_FINDING_EXT_URL = "http://fhir-client.local/StructureDefinition/rad-critical-finding";
/** 所見・診断をテンプレートから記載したときの記入内容(QuestionnaireResponse)への参照。 */
const FINDINGS_QR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/rad-report-findings-response";
const CONCLUSION_QR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/rad-report-conclusion-response";

/**
 * 1 回の保存で新しく送る画像(base64)の合計の上限。上流は本文が 10MB を超えると 413 で
 * 拒否するので、本文・テンプレート回答の余白を残した値にする。保存済みの画像は参照だけで
 * 再送しないので、分けて保存すれば枚数の制限にはならない。
 */
export const RAD_REPORT_MAX_NEW_IMAGE_LENGTH = 7 * 1024 * 1024;

export const RAD_REPORT_TOO_LARGE_MESSAGE =
  "一度に添付できる画像の量を超えています。いったん保存してから追加してください。";

// ---- 報告区分 ----

export type RadReportStatus = "preliminary" | "final" | "amended";

/** 画面で選べるのは暫定と最終。訂正は確定後の編集保存で自動的に付く。 */
export const RAD_REPORT_STATUS_OPTIONS: { code: "preliminary" | "final"; display: string }[] = [
  { code: "preliminary", display: "暫定報告" },
  { code: "final", display: "最終報告" },
];

export function radReportStatusDisplay(status: string | undefined): string {
  if (status === "amended") return "訂正報告";
  return RAD_REPORT_STATUS_OPTIONS.find((o) => o.code === status)?.display ?? "";
}

// ---- フォーム値 ----

/** 画像の実体。保存済みは binaryId、足したばかりは dataUrl を持つ。 */
export interface RadReportImageData {
  binaryId: string;
  dataUrl: string;
  contentType: string;
}

export interface RadReportImageValues {
  source: RadReportImageData;
  /** 描き込みの合成画像。描き込みが無ければ null。 */
  annotated: RadReportImageData | null;
  caption: string;
}

export interface RadReportFormValues {
  orderId: string;
  setting: LabResultSetting;
  departmentId: string;
  departmentName: string;
  /** 撮影日時。実施記録の performedDateTime、無ければオーダーの occurrenceDateTime。 */
  effectiveDateTime: string;
  /** 撮影内容(code.text)。オーダーの GP の見出しを並べたもの。 */
  examText: string;
  reportStatus: "preliminary" | "final";
  findings: string;
  findingsTemplate: TemplateBinding | null;
  conclusion: string;
  conclusionTemplate: TemplateBinding | null;
  criticalFinding: boolean;
  criticalFindingText: string;
  images: RadReportImageValues[];
  /** 読影医。保存時にログイン中の医療従事者を入れ、編集では最初の読影医を残す。 */
  interpreterId: string;
  interpreterName: string;
  organizationId: string;
  organizationName: string;
  /** 以下は編集時の復元用。 */
  findingsId?: string;
  originalStatus?: RadReportStatus;
}

/** オーダーの内容から撮影内容の文言を作る(「Ｘ線CT | 胸部単純CT・…」)。 */
export function radExamText(order: fhir4.ServiceRequest, itemRequests: fhir4.ServiceRequest[]): string {
  return orderEntries(radOrderItems(order, itemRequests)).map(entryLabel).join("・");
}

/**
 * 実施記録から撮影日時を取る。取消 → 再実施でハブが複数残ることがあるので最も新しいもの。
 * 実施入力をしない撮影項目では実施記録が無いので空を返す(呼び出し側がオーダーの日時で補う)。
 */
export function radPerformedDateTime(procedures: fhir4.Procedure[]): string {
  return procedures
    .filter(
      (p) =>
        isRadProcedure(p) &&
        !p.partOf?.length &&
        p.status !== "entered-in-error" &&
        Boolean(p.performedDateTime),
    )
    .map((p) => p.performedDateTime as string)
    .sort()
    .pop() ?? "";
}

export function emptyRadReportForm(
  order: fhir4.ServiceRequest,
  itemRequests: fhir4.ServiceRequest[],
  procedures: fhir4.Procedure[],
): RadReportFormValues {
  const requester = prescriptionRequester(order);
  return {
    orderId: order.id ?? "",
    setting: (summarizeRadOrder(order).settingCode || "outpatient") as LabResultSetting,
    departmentId: requester.departmentId,
    departmentName: requester.departmentName,
    effectiveDateTime: radPerformedDateTime(procedures) || order.occurrenceDateTime || "",
    examText: radExamText(order, itemRequests),
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
export function nextRadReportStatus(values: RadReportFormValues): RadReportStatus {
  const original = values.originalStatus;
  return original && original !== "preliminary" ? "amended" : values.reportStatus;
}

export function willBecomeAmended(values: RadReportFormValues): boolean {
  return nextRadReportStatus(values) === "amended";
}

/** 表示する画像(描き込みがあればそれ)。 */
export function displayedImage(image: RadReportImageValues): RadReportImageData {
  return image.annotated ?? image.source;
}

/** SchemaImageGallery に渡す形。表示は描き込みがあれば描き込み画像。 */
export function radReportImageRefs(images: RadReportImageValues[]): SchemaImageRef[] {
  return images.map((image, index) => {
    const shown = displayedImage(image);
    return {
      key: `rad-report-image#${index}`,
      label: image.caption,
      binaryId: shown.binaryId || null,
      dataUrl: shown.dataUrl || null,
    };
  });
}

/** 拡大表示(ReportImageViewerModal)に渡す形。描き込みがあれば元画像と切り替えられる。 */
export function radReportViewerImages(images: RadReportImageValues[]) {
  const dataOf = (data: RadReportImageData) => ({
    binaryId: data.binaryId || null,
    dataUrl: data.dataUrl || null,
  });
  return images.map((image, index) => ({
    key: `rad-report-image#${index}`,
    caption: image.caption,
    image: dataOf(displayedImage(image)),
    original: image.annotated ? dataOf(image.source) : null,
  }));
}

// ---- FHIR リソースの組み立て ----

/** 画像の実体を Bundle に積み、拡張に書く参照を返す。 */
function imageReference(entries: fhir4.BundleEntry[], image: RadReportImageData): string | null {
  if (image.binaryId) return `Binary/${image.binaryId}`;
  if (!image.dataUrl) return null;
  const { placeholder, entry } = imageBinaryEntry(image.dataUrl, image.contentType || "image/jpeg");
  entries.push(entry);
  return placeholder;
}

function pushImageEntries(
  entries: fhir4.BundleEntry[],
  images: RadReportImageValues[],
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
    return [{ url: REPORT_IMAGE_EXT_URL, extension }];
  });
}

/**
 * テンプレートの記入内容を Bundle に積み、レポートから指す参照を返す。
 * 保存済みの回答を再編集していなければ参照だけ引き継ぐ(放射線オーダーの検査目的と同じ形)。
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

export interface RadReportSaveTarget {
  reportId?: string;
  /** 編集前のレポートが参照していた所見 Observation とテンプレート回答。外れたものを消す。 */
  originalObservationIds?: string[];
  originalResponseIds?: string[];
}

export function buildRadReportBundle(
  values: RadReportFormValues,
  patientId: string,
  { reportId, originalObservationIds = [], originalResponseIds = [] }: RadReportSaveTarget = {},
): fhir4.Bundle {
  const status = nextRadReportStatus(values);
  const reportReference = reportId ? `DiagnosticReport/${reportId}` : `urn:uuid:${crypto.randomUUID()}`;

  // 画像とテンプレート回答はレポートが参照するので、レポートより先に積む。
  const leadingEntries: fhir4.BundleEntry[] = [];
  const imageExtensions = pushImageEntries(leadingEntries, values.images);
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
      category: [
        { coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: "imaging", display: "Imaging" }] },
      ],
      code: {
        coding: [{ system: REPORT_ITEM_SYSTEM, code: FINDINGS_CODE, display: "所見" }],
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
      ? [{ url: CRITICAL_FINDING_EXT_URL, valueString: values.criticalFindingText.trim() }]
      : []),
    ...(findingsResponse
      ? [{ url: FINDINGS_QR_EXT_URL, valueReference: { reference: findingsResponse } }]
      : []),
    ...(conclusionResponse
      ? [{ url: CONCLUSION_QR_EXT_URL, valueReference: { reference: conclusionResponse } }]
      : []),
  ];

  const report: fhir4.DiagnosticReport = {
    resourceType: "DiagnosticReport",
    ...(extension.length > 0 ? { extension } : {}),
    basedOn: [{ reference: `ServiceRequest/${values.orderId}` }],
    status,
    category: [
      { coding: [{ system: LOINC_SYSTEM, code: RADIOLOGY_CATEGORY_CODE, display: "Radiology" }] },
      { coding: [{ system: REPORT_CATEGORY_SYSTEM, code: "RAD", display: "Radiology" }] },
      {
        coding: [
          { system: SETTING_SYSTEM, code: values.setting, display: findSettingDisplay(values.setting) },
        ],
      },
    ],
    code: {
      coding: [
        { system: DOCUMENT_CODES_SYSTEM, code: RADIOLOGY_REPORT_CODE, display: "画像検査報告書" },
      ],
      text: values.examText || "画像検査報告書",
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
export function radReportBundleTooLarge(bundle: fhir4.Bundle): boolean {
  return newBinaryDataLength(bundle.entry ?? []) > RAD_REPORT_MAX_NEW_IMAGE_LENGTH;
}

/**
 * レポートの削除。所見とテンプレート回答も消す。画像の Binary は消さない
 * (上流の旧版が参照しているため。readme「シェーマ画像」)。
 */
export function buildRadReportDeleteEntries(report: fhir4.DiagnosticReport): fhir4.BundleEntry[] {
  return [
    { request: { method: "DELETE", url: `DiagnosticReport/${report.id}` } },
    ...radReportObservationIds(report).map((id) => ({
      request: { method: "DELETE" as const, url: `Observation/${id}` },
    })),
    ...radReportResponseIds(report).map((id) => ({
      request: { method: "DELETE" as const, url: `QuestionnaireResponse/${id}` },
    })),
  ];
}

// ---- 読み戻し ----

/** 読影レポートか(同じオーダーに別の種類の DiagnosticReport が付くことは無いが、念のため判定する)。 */
export function isRadReport(report: fhir4.DiagnosticReport): boolean {
  return Boolean(
    report.category?.some((category) =>
      category.coding?.some(
        (c) => c.system === LOINC_SYSTEM && c.code === RADIOLOGY_CATEGORY_CODE,
      ),
    ),
  );
}

export function radReportObservationIds(report: fhir4.DiagnosticReport): string[] {
  return (report.result ?? [])
    .map((reference) => reference.reference?.match(/^Observation\/(.+)$/)?.[1])
    .filter((id): id is string => Boolean(id));
}

function responseIdOf(report: fhir4.DiagnosticReport, url: string): string | null {
  const reference = report.extension?.find((e) => e.url === url)?.valueReference?.reference;
  return reference?.match(/^QuestionnaireResponse\/(.+)$/)?.[1] ?? null;
}

export function radReportResponseIds(report: fhir4.DiagnosticReport): string[] {
  return [responseIdOf(report, FINDINGS_QR_EXT_URL), responseIdOf(report, CONCLUSION_QR_EXT_URL)].filter(
    (id): id is string => Boolean(id),
  );
}

/** 重要所見の要点。無ければ空。 */
export function radCriticalFindingOf(report: fhir4.DiagnosticReport): string {
  return report.extension?.find((e) => e.url === CRITICAL_FINDING_EXT_URL)?.valueString ?? "";
}

function imageDataOf(attachment: fhir4.Attachment | undefined): RadReportImageData | null {
  const binaryId = binaryIdFromAttachment(attachment);
  if (!binaryId) return null;
  return { binaryId, dataUrl: "", contentType: attachment?.contentType ?? "image/jpeg" };
}

/** 添付画像。拡張の並び順が表示順。 */
export function radReportImages(report: fhir4.DiagnosticReport): RadReportImageValues[] {
  return (report.extension ?? [])
    .filter((e) => e.url === REPORT_IMAGE_EXT_URL)
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

export interface RadReportDetail {
  report?: fhir4.DiagnosticReport;
  observations: fhir4.Observation[];
}

/** `_include=DiagnosticReport:result` の応答を分ける。 */
export function splitRadReportBundle(bundle: fhir4.Bundle | undefined): RadReportDetail {
  const result: RadReportDetail = { observations: [] };
  for (const entry of bundle?.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "DiagnosticReport") {
      const report = resource as fhir4.DiagnosticReport;
      if (!result.report && isRadReport(report)) result.report = report;
    } else if (resource?.resourceType === "Observation") {
      result.observations.push(resource as fhir4.Observation);
    }
  }
  return result;
}

function findingsObservation(observations: fhir4.Observation[]): fhir4.Observation | undefined {
  return observations.find(
    (o) => codingBySystem(o.code.coding, REPORT_ITEM_SYSTEM)?.code === FINDINGS_CODE,
  );
}

function referenceOf(references: fhir4.Reference[] | undefined, type: string) {
  const reference = references?.find((r) => r.reference?.startsWith(`${type}/`));
  return { id: reference?.reference?.split("/")[1] ?? "", display: reference?.display ?? "" };
}

export function parseRadReportForm(
  report: fhir4.DiagnosticReport,
  observations: fhir4.Observation[],
): RadReportFormValues {
  const findings = findingsObservation(observations);
  const department = departmentOf(report);
  const interpreter = referenceOf(report.resultsInterpreter, "Practitioner");
  const organization = referenceOf(report.performer, "Organization");
  const criticalFindingText = radCriticalFindingOf(report);
  const findingsResponseId = responseIdOf(report, FINDINGS_QR_EXT_URL);
  const conclusionResponseId = responseIdOf(report, CONCLUSION_QR_EXT_URL);

  return {
    orderId: referenceOf(report.basedOn, "ServiceRequest").id,
    setting: (categoryCoding(report, SETTING_SYSTEM)?.code ?? "") as LabResultSetting,
    departmentId: department.departmentId,
    departmentName: department.departmentName,
    effectiveDateTime: report.effectiveDateTime ?? "",
    examText: report.code?.text ?? "",
    // 訂正報告は最終報告として編集を続ける(次の保存でまた amended になる)。
    reportStatus: report.status === "preliminary" ? "preliminary" : "final",
    originalStatus: report.status as RadReportStatus,
    findings: findings?.valueString ?? "",
    findingsId: findings?.id,
    findingsTemplate: findingsResponseId ? { responseId: findingsResponseId, draft: null } : null,
    conclusion: report.conclusion ?? "",
    conclusionTemplate: conclusionResponseId
      ? { responseId: conclusionResponseId, draft: null }
      : null,
    criticalFinding: Boolean(criticalFindingText),
    criticalFindingText,
    images: radReportImages(report),
    interpreterId: interpreter.id,
    interpreterName: interpreter.display,
    organizationId: organization.id,
    organizationName: organization.display,
  };
}

/** 撮影日時・報告日時の表示("YYYY-MM-DD HH:mm"。日付だけのものは日付)。 */
export function radReportDateTimeLabel(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 10) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16).replace("T", " ");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
