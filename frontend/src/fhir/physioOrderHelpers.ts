import { today } from "../lib/dates";
import type { OrderContext } from "../orderContext";
import { buildExamAppointmentEntries, type SlotSelection } from "./appointmentHelpers";
import { slotDate, slotTime } from "./scheduleHelpers";
// FHIR dateTime へのタイムゾーン付与は診療記録と同じ変換でよいので共用する。
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { categoryCoding, displayOf, itemNumber, parentRequestId, PRIORITY_OPTIONS } from "./shared";

export { PRIORITY_OPTIONS };
import type { TemplateBinding } from "./questionnaireResponseHelpers";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
  codingBySystem,
  type PrescriptionSetting,
} from "./prescriptionHelpers";

// 生理検査オーダー。放射線検査と同じくオーダーヘッダは ServiceRequest で、
// 明細(検査 1 件)も 1 件ずつ独立した ServiceRequest にする。
//
//   ヘッダ ← basedOn ── 明細(単項目・セット) ← basedOn ── セットの構成項目
//
// 明細の各 ServiceRequest は、オーダーした時点の生理検査オーダー項目マスタの内容
// (項目コード・名称・略称・検査種別)を写して持つ。マスタを直した後に過去の
// オーダーの中身が変わってしまわないよう、参照ではなく写し。
//
// 放射線検査との違い:
// - JJ1017 を持たない。生理検査は JJ1017 に収載されていないため、32桁コードと
//   その分割(16M / 16S)は載せない。
// - bodySite を持たない。生理検査は「腹部超音波」「下肢静脈エコー」のように
//   項目名が部位を含み、JJ1017P に代わる標準の部位コード体系も無い。text だけを
//   載せても検索にも表示にも使い道がないので、部位は項目名で表す。
// - モダリティの代わりに、施設が定義する検査種別(心電図・超音波検査 など)を
//   明細の category に出す。検査室・装置の単位で、部門一覧の絞り込み軸でもある。
//
// オーダーの単位(GP)は「単独で選んだ検査項目 1 つ」または「セット 1 つ」。
// 依頼病名・検査目的・特別指示はこの GP 単位で入力し、GP を表す明細
// (単項目ならその項目、セットならセット親)の ServiceRequest に載せる。
// - 依頼病名: 登録病名から選んだなら reasonReference(Condition)、
//   フリーテキストなら reasonCode.text。
// - 特別指示: note。Annotation は「その依頼へのコメント」そのものなので標準要素に載せる。
// - 検査目的: FHIR に当てはまる標準要素が無い(reason* は依頼病名で使う)ため、
//   他のローカル拡張と同じ流儀で拡張にする。
//
// 検査目的・特別指示をテンプレートから記載した場合は、診療記録(SOAP)と同じく
// 記入内容を QuestionnaireResponse として保存し、明細から拡張で参照する。
// 参照があれば後からテンプレート画面で開き直して書き換えられる。

// 処方・注射・検体検査・放射線検査の ServiceRequest と区別するオーダー種別。
export const PHYSIO_ORDER_TYPE = { code: "physio", display: "生理検査" };

// 生理検査オーダー項目マスタの独自コード。
const ORDER_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/physio-order-item";
// 検査種別(心電図・超音波検査 など)。施設が定義するローカルコード。
const EXAM_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/physio-exam-type";
// 略称。検体検査・放射線検査と同じ CodeSystem を使う(検査項目の略称という意味は同じ)。
const ABBREVIATION_SYSTEM = "http://fhir-client.local/CodeSystem/lab-item-abbreviation";
// 検査目的。標準要素に当てはまるものが無いのでローカル拡張で持つ。
const EXAM_PURPOSE_EXT_URL = "http://fhir-client.local/StructureDefinition/physio-exam-purpose";
// テンプレートから記載したときの記入内容(QuestionnaireResponse)への参照。
// 命名は診療記録の clinical-note-section-questionnaire-response に合わせる。
const PURPOSE_QR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/physio-exam-purpose-questionnaire-response";
const REMARKS_QR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/physio-remarks-questionnaire-response";

// 明細の並び順。独立したリソースは検索の戻り順が保証されないため、伝票で選んだ
// 順番を明細自身に持たせる(検体検査・処方の RP 番号と同じ考え方)。
const ITEM_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/physio-order-item-number";

export type PhysioOrderPriority = "routine" | "urgent";

/** オーダーした検査 1 件。マスタの写しなので、表示に必要な値をすべて持つ。 */
export interface PhysioOrderItemLine {
  /** 明細の ServiceRequest の id。画面で足したばかりの項目は空(登録時に採番)。 */
  id: string;
  /** 生理検査オーダー項目マスタの項目コード。 */
  code: string;
  name: string;
  /** 略称。カードのように狭い場所で構成項目を並べるときに使う。 */
  shortName: string;
  /** 検査種別(心電図・超音波検査 など)。オーダー内容をまとめて見せる軸。 */
  examTypeCode: string;
  examTypeName: string;
  /**
   * 依頼病名。登録病名から選んだ場合はその Condition の id。
   * 空ならフリーテキスト(reasonName だけを持つ)。
   */
  reasonConditionId: string;
  /** 依頼病名の表示。登録病名から選んだ場合はその病名、フリーテキストなら入力値。 */
  reasonName: string;
  /** 検査目的。テンプレート記入かフリーテキストで入れる。 */
  purpose: string;
  /** 特別指示。テンプレート記入かフリーテキストで入れる。 */
  remarks: string;
  /**
   * 検査目的・特別指示をテンプレートから記載した場合の回答の紐付け。
   * null ならフリーテキスト(直接編集できる)。
   */
  purposeTemplate: TemplateBinding | null;
  remarksTemplate: TemplateBinding | null;
  /**
   * セットの構成項目としてオーダーした場合、その親(セット)の項目コード。
   * 空ならオーダー画面で単独で選んだ項目。同じ項目がセットの構成項目としても
   * 単独としても入ることはない(選択時にどちらか一方へ寄せる)。
   */
  parentCode: string;
  /**
   * 他の検査項目と同じオーダーにまとめられるか(マスタの写しではなく、登録時に
   * オーダーを分けるためだけに使う印)。false の項目は 1 件で 1 オーダーになる。
   * FHIR には出さないので、保存済みのオーダーを読んだ時点では判断できない。
   * オーダー画面が登録前にマスタから引き直して入れる。
   */
  groupable: boolean;
  /**
   * 単独オーダー枠の実施日("YYYY-MM-DD")と実施時刻("HH:mm"、任意)、至急区分。
   * これらはオーダー枠(=登録される 1 オーダー)ごとの入力で、まとめ枠のぶんは
   * PhysioOrderFormValues の同名の項目が担う。groupable と同じく登録時の分割にだけ
   * 使う画面の値で、行としては FHIR に出さない(分割後にヘッダへ写る)。
   * 予約必須の項目では予約した枠の日時が入る。
   */
  date: string;
  time: string;
  priority: PhysioOrderPriority;
}

export interface PhysioOrderFormValues {
  setting: PrescriptionSetting;
  /** 至急区分。オーダー枠ごとの入力で、これはまとめ枠のぶん(単独枠は行が持つ)。 */
  priority: PhysioOrderPriority;
  /** 実施日。 */
  authoredDate: string;
  /**
   * 実施時刻(HH:mm)。検査の予定時刻を指定する場合だけ入れる任意入力で、
   * 空なら実施日だけのオーダー(時間帯は部門側に任せる)。
   */
  authoredTime: string;
  // 対象プロブレム(POMR)。null なら特定の問題に紐付かない検査。
  problem: ProblemRef | null;
  items: PhysioOrderItemLine[];
}

export function emptyPhysioOrderForm(
  problem: ProblemRef | null = null,
  setting: PrescriptionSetting = "outpatient",
): PhysioOrderFormValues {
  return {
    setting,
    priority: "routine",
    authoredDate: today(),
    authoredTime: "",
    problem,
    items: [],
  };
}

export function priorityDisplay(priority: string | undefined): string {
  return priority ? displayOf(PRIORITY_OPTIONS, priority) : "";
}

// ---- オーダーの単位(GP) ----
//
// 1 GP = 単独で選んだ検査項目 1 つ、またはセット 1 つ。セットは親を GP とし、
// 構成する検査は GP の中身として並べる(オーダー画面のプレビュー・カルテのカード・
// 詳細で共用)。

/** オーダーの 1 単位。セットなら members にその構成項目が入る。 */
export interface PhysioOrderEntry {
  item: PhysioOrderItemLine;
  members: PhysioOrderItemLine[];
}

/** 単独で選んだ項目(セットを含む)。構成項目は除く。 */
export function topLevelItems(items: PhysioOrderItemLine[]): PhysioOrderItemLine[] {
  return items.filter((item) => !item.parentCode);
}

/** 指定したセットの構成項目。 */
export function membersOf(items: PhysioOrderItemLine[], setCode: string): PhysioOrderItemLine[] {
  return items.filter((item) => item.parentCode === setCode);
}

/** オーダーを GP(単独項目・セット)の並びにする。選んだ順のまま。 */
export function orderEntries(items: PhysioOrderItemLine[]): PhysioOrderEntry[] {
  return topLevelItems(items).map((item) => ({ item, members: membersOf(items, item.code) }));
}

/** GP の検査種別。セットは自身に種別を持たないことがあるので構成項目から補う。 */
export function entryExamTypeName(entry: PhysioOrderEntry): string {
  return entry.item.examTypeName || entry.members[0]?.examTypeName || "";
}

/** GP の見出し(「心電図 | 心電図12誘導」)。区切りはカードの見出し・
 *  メタ行(「外来 | 内科 | 児玉 義憲」)と同じ縦棒に揃える。 */
export function entryLabel(entry: PhysioOrderEntry): string {
  return [entryExamTypeName(entry), entry.item.name].filter(Boolean).join(" | ");
}

// ---- FHIR リソースの組み立て ----

/** ServiceRequest が生理検査オーダーかどうか。処方・注射・検体検査との振り分けに使う。 */
export function isPhysioServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return (sr.category ?? []).some((category) =>
    category.coding?.some((c) => c.system === ORDER_TYPE_SYSTEM && c.code === PHYSIO_ORDER_TYPE.code),
  );
}

// 明細 1 件(検査 1 つ)の ServiceRequest。親(ヘッダ、またはセット)を basedOn で指す。
// parentReference には Bundle 内の fullUrl をそのまま渡すので、新規登録では
// urn:uuid、更新では ServiceRequest/{id} になる。
function buildItemRequest(
  item: PhysioOrderItemLine,
  sequence: number,
  patientId: string,
  authoredOn: string,
  parentReference: string,
  // テンプレート記入内容(QuestionnaireResponse)への参照。Bundle 内で解決するため
  // 呼び出し側が組み立てて渡す(新規は urn:uuid、既存は QuestionnaireResponse/{id})。
  templateRefs: { purpose: string; remarks: string },
): fhir4.ServiceRequest {
  const coding: fhir4.Coding[] = [
    { system: ORDER_ITEM_SYSTEM, code: item.code, display: item.name },
  ];
  if (item.shortName) {
    coding.push({ system: ABBREVIATION_SYSTEM, code: item.shortName, display: item.shortName });
  }

  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    identifier: [{ system: ITEM_NUMBER_SYSTEM, value: String(sequence) }],
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    code: { coding, text: item.name },
    basedOn: [{ reference: parentReference }],
  };
  if (item.id) resource.id = item.id;

  if (item.examTypeCode) {
    resource.category = [
      {
        coding: [
          {
            system: EXAM_TYPE_SYSTEM,
            code: item.examTypeCode,
            display: item.examTypeName || undefined,
          },
        ],
        text: item.examTypeName || undefined,
      },
    ];
  }

  // 依頼病名。登録病名から選んだものは参照で、フリーテキストはそのまま文字列で持つ。
  if (item.reasonConditionId) {
    resource.reasonReference = [
      { reference: `Condition/${item.reasonConditionId}`, display: item.reasonName || undefined },
    ];
  } else if (item.reasonName) {
    resource.reasonCode = [{ text: item.reasonName }];
  }
  const extension: fhir4.Extension[] = [];
  if (item.purpose) extension.push({ url: EXAM_PURPOSE_EXT_URL, valueString: item.purpose });
  if (templateRefs.purpose) {
    extension.push({ url: PURPOSE_QR_EXT_URL, valueReference: { reference: templateRefs.purpose } });
  }
  if (templateRefs.remarks) {
    extension.push({ url: REMARKS_QR_EXT_URL, valueReference: { reference: templateRefs.remarks } });
  }
  if (extension.length > 0) resource.extension = extension;

  if (item.remarks) {
    resource.note = [{ text: item.remarks }];
  }

  return resource;
}

// 保存済みのテンプレート回答 id。拡張の参照から取り出す。
function responseIdOf(request: fhir4.ServiceRequest, url: string): string | null {
  const reference = request.extension?.find((e) => e.url === url)?.valueReference?.reference;
  return reference?.match(/^QuestionnaireResponse\/(.+)$/)?.[1] ?? null;
}

/** 明細が参照しているテンプレート回答の id 一覧(更新・削除で孤児を残さないために使う)。 */
export function physioOrderResponseIds(itemRequests: fhir4.ServiceRequest[]): string[] {
  return itemRequests.flatMap((request) =>
    [responseIdOf(request, PURPOSE_QR_EXT_URL), responseIdOf(request, REMARKS_QR_EXT_URL)].filter(
      (id): id is string => Boolean(id),
    ),
  );
}

function bindingOf(responseId: string | null): TemplateBinding | null {
  return responseId ? { responseId, draft: null } : null;
}

function parseItemRequest(request: fhir4.ServiceRequest, parentCode: string): PhysioOrderItemLine {
  const coding = request.code?.coding;
  const itemCoding = codingBySystem(coding, ORDER_ITEM_SYSTEM);
  const abbreviation = codingBySystem(coding, ABBREVIATION_SYSTEM);
  const examType = categoryCoding(request, EXAM_TYPE_SYSTEM);
  const reasonReference = request.reasonReference?.find((r) =>
    r.reference?.startsWith("Condition/"),
  );

  return {
    id: request.id ?? "",
    code: itemCoding?.code ?? "",
    name: itemCoding?.display ?? request.code?.text ?? "",
    shortName: abbreviation?.code ?? "",
    examTypeCode: examType?.code ?? "",
    examTypeName: examType?.display ?? "",
    reasonConditionId: reasonReference?.reference?.split("/").pop() ?? "",
    reasonName: reasonReference?.display ?? request.reasonCode?.[0]?.text ?? "",
    purpose: request.extension?.find((e) => e.url === EXAM_PURPOSE_EXT_URL)?.valueString ?? "",
    remarks: request.note?.[0]?.text ?? "",
    // draft は null = 「再編集されるまで回答は触らない」(診療記録と同じ)。
    purposeTemplate: bindingOf(responseIdOf(request, PURPOSE_QR_EXT_URL)),
    remarksTemplate: bindingOf(responseIdOf(request, REMARKS_QR_EXT_URL)),
    parentCode,
    // 保存済みのオーダーには載っていない印なので、いったんグループ化として読む。
    // 編集・DO では、登録前にオーダー画面が今のマスタから入れ直す。
    groupable: true,
    // 実施日時・至急区分も明細には載らない(ヘッダが正)。編集はヘッダ 1 件への
    // 書き戻しで values 側を使うので、行は既定のままでよい。
    date: "",
    time: "",
    priority: "routine",
  };
}

// 明細の Bundle エントリ。既にある明細は PUT、画面で足したものは POST、
// 外した明細は DELETE(呼び出し側が元の id 一覧を渡す)。
// テンプレート記入内容(QuestionnaireResponse)も同じ Bundle に積み、参照が外れた
// 回答は DELETE する(本体を保存しなかったときに回答だけ残る孤児を作らない)。
function buildItemEntries(
  items: PhysioOrderItemLine[],
  patientId: string,
  authoredOn: string,
  headerReference: string,
  originalItemIds: string[],
  originalResponseIds: string[],
): fhir4.BundleEntry[] {
  const entries: fhir4.BundleEntry[] = [];
  const keptItemIds = new Set<string>();
  const keptResponseIds = new Set<string>();
  let sequence = 0;

  // テンプレート記入内容を Bundle に積み、明細から指す参照を返す。
  // 未記入・未使用なら空文字(拡張を出さない)。
  const templateReference = (binding: TemplateBinding | null): string => {
    if (!binding) return "";
    const { responseId, draft } = binding;
    if (!draft) {
      // 再編集していない保存済みの回答 → 参照だけ引き継ぐ。
      if (!responseId) return "";
      keptResponseIds.add(responseId);
      return `QuestionnaireResponse/${responseId}`;
    }
    // 保存済みの再編集は同じ id へ PUT、新規記入は urn:uuid で POST し、
    // 実 ID への解決は上流の transaction 処理に任せる。
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
  };

  const pushEntry = (item: PhysioOrderItemLine, parentReference: string): string => {
    sequence += 1;
    const fullUrl = item.id ? `ServiceRequest/${item.id}` : `urn:uuid:${crypto.randomUUID()}`;
    if (item.id) keptItemIds.add(item.id);

    const templateRefs = {
      purpose: templateReference(item.purposeTemplate),
      remarks: templateReference(item.remarksTemplate),
    };

    entries.push({
      fullUrl,
      resource: buildItemRequest(
        item,
        sequence,
        patientId,
        authoredOn,
        parentReference,
        templateRefs,
      ),
      request: item.id
        ? { method: "PUT", url: `ServiceRequest/${item.id}` }
        : { method: "POST", url: "ServiceRequest" },
    });
    return fullUrl;
  };

  for (const item of topLevelItems(items)) {
    const itemReference = pushEntry(item, headerReference);
    for (const member of membersOf(items, item.code)) pushEntry(member, itemReference);
  }

  for (const id of originalItemIds) {
    if (!keptItemIds.has(id)) {
      entries.push({ request: { method: "DELETE", url: `ServiceRequest/${id}` } });
    }
  }
  for (const id of originalResponseIds) {
    if (!keptResponseIds.has(id)) {
      entries.push({ request: { method: "DELETE", url: `QuestionnaireResponse/${id}` } });
    }
  }

  return entries;
}

// 明細の ServiceRequest 群を、親子の分かる 1 本の配列にする。
// requests には単独の項目・セット・セットの構成項目が混ざって届く。
function parseItemRequests(
  requests: fhir4.ServiceRequest[],
  headerId: string | undefined,
): PhysioOrderItemLine[] {
  // 明細の id → 項目コード。構成項目に親のコードを持たせる。
  const codeById = new Map<string, string>();
  for (const request of requests) {
    const code = codingBySystem(request.code?.coding, ORDER_ITEM_SYSTEM)?.code;
    if (request.id && code) codeById.set(request.id, code);
  }

  return [...requests]
    .sort((a, b) => itemNumber(a, ITEM_NUMBER_SYSTEM) - itemNumber(b, ITEM_NUMBER_SYSTEM))
    .map((request) => {
      const parentId = request.basedOn?.[0]?.reference?.split("/").pop() ?? "";
      // ヘッダを指しているものは単独で選んだ項目(親コードなし)。
      const parentCode = parentId === headerId ? "" : (codeById.get(parentId) ?? "");
      return parseItemRequest(request, parentCode);
    });
}

function buildPhysioOrderServiceRequest(
  values: PhysioOrderFormValues,
  patientId: string,
  requester: OrderContext,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    priority: values.priority,
    // 読み出し側は system で引くので順序には依存しない。入外区分は未選択のことが
    // あるので、空の Coding(code が空文字)を作らないよう選択時だけ足す。
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...PHYSIO_ORDER_TYPE }] },
      ...(values.setting
        ? [
            {
              coding: [
                {
                  system: SETTING_SYSTEM,
                  code: values.setting,
                  display: displayOf(SETTING_OPTIONS, values.setting),
                },
              ],
            },
          ]
        : []),
    ],
    subject: { reference: `Patient/${patientId}` },
    authoredOn: values.authoredDate,
    // 実施日時。オーダー日と同じ日を入れる(実施日として 1 つだけ入力する)。
    // 実施時刻を指定したときだけ時刻まで入れる(FHIR の dateTime は時刻を持つなら
    // タイムゾーンが必須なので、実行環境のオフセットを付ける)。
    occurrenceDateTime: values.authoredTime
      ? toFhirDateTime(`${values.authoredDate}T${values.authoredTime}`)
      : values.authoredDate,
  };

  if (serviceRequestId) resource.id = serviceRequestId;
  if (values.problem) {
    resource.reasonReference = [
      {
        reference: `Condition/${values.problem.conditionId}`,
        display: values.problem.display,
      },
    ];
  }
  applyOrderContext(resource, requester);

  return resource;
}

/** オーダー 1 件ぶんの Bundle エントリと、そのヘッダ。 */
export interface PhysioOrderEntries {
  /** ヘッダの ServiceRequest。即実施の Task を組み立てる元になる。 */
  header: fhir4.ServiceRequest;
  /** ヘッダを指す参照。新規登録では urn:uuid、更新では ServiceRequest/{id}。 */
  headerReference: string;
  entries: fhir4.BundleEntry[];
}

// オーダー 1 件(ヘッダ 1 + 明細 N)の Bundle エントリ。新規登録ではヘッダを
// urn:uuid で参照するので、明細の basedOn はサーバー側で採番後の id に解決される。
export function buildPhysioOrderEntries(
  values: PhysioOrderFormValues,
  patientId: string,
  requester: OrderContext,
  serviceRequestId?: string,
  originalItemIds: string[] = [],
  originalResponseIds: string[] = [],
): PhysioOrderEntries {
  const headerReference = serviceRequestId
    ? `ServiceRequest/${serviceRequestId}`
    : `urn:uuid:${crypto.randomUUID()}`;
  const header = buildPhysioOrderServiceRequest(values, patientId, requester, serviceRequestId);

  return {
    header,
    headerReference,
    entries: [
      {
        fullUrl: headerReference,
        resource: header,
        request: serviceRequestId
          ? { method: "PUT", url: `ServiceRequest/${serviceRequestId}` }
          : { method: "POST", url: "ServiceRequest" },
      },
      ...buildItemEntries(
        values.items,
        patientId,
        values.authoredDate,
        headerReference,
        originalItemIds,
        originalResponseIds,
      ),
    ],
  };
}

function transactionBundle(entry: fhir4.BundleEntry[]): fhir4.Bundle {
  return { resourceType: "Bundle", type: "transaction", entry };
}

/** 登録する 1 オーダーぶんの入力。 */
export interface PhysioOrderSplit {
  /**
   * オーダーの識別子。まとめて登録するオーダーは空文字、単独オーダーはその項目コード
   * (単独の項目は 1 件で 1 オーダーになるので、項目コードがそのままオーダーを指す)。
   * 即実施の実施入力をオーダーごとに持たせるための添字に使う。
   */
  key: string;
  values: PhysioOrderFormValues;
}

/**
 * 選んだ検査項目を、登録する 1 オーダーぶんずつに分ける。
 *
 * CT・MRI などは 1 検査に時間を要し、検査室の枠を 1 件ずつ押さえる必要があるため、
 * マスタで「単独」にした項目は 1 オーダー 1 検査項目にする。オーダー画面では他の
 * 項目と一度に選べるが、登録時にここで別のオーダー(別のカルテカード)へ分ける。
 *
 * 入外区分・至急区分・実施日時・対象プロブレムは伝票共通の入力なので
 * 各オーダーへ写す。並びは、まとめられる項目のオーダーを先頭に、単独の項目を選んだ順。
 */
export function splitPhysioOrderValues(values: PhysioOrderFormValues): PhysioOrderSplit[] {
  const groupedLines: PhysioOrderItemLine[] = [];
  const soloOrders: PhysioOrderSplit[] = [];

  for (const item of topLevelItems(values.items)) {
    // セットは構成項目と一緒でなければ意味がないので、必ず同じオーダーに入れる。
    const lines = [item, ...membersOf(values.items, item.code)];
    if (item.groupable) groupedLines.push(...lines);
    else {
      // 実施日時・至急区分はオーダー枠ごとの入力。単独枠は行が持つ値をこのオーダーの
      // 値にする(日時が未入力なら共通値のまま)。
      soloOrders.push({
        key: item.code,
        values: {
          ...values,
          items: lines,
          priority: item.priority,
          authoredDate: item.date || values.authoredDate,
          authoredTime: item.date ? item.time : values.authoredTime,
        },
      });
    }
  }

  if (groupedLines.length > 0) {
    return [{ key: "", values: { ...values, items: groupedLines } }, ...soloOrders];
  }
  // 検査項目が 1 つも無い場合も呼び出し側の検証に任せ、空のオーダーを 1 件返す。
  return soloOrders.length > 0 ? soloOrders : [{ key: "", values: { ...values, items: [] } }];
}

/** 予約必須オーダーの予約内容。キーは splitPhysioOrderValues のキー(=検査項目コード)。 */
export interface PhysioOrderBooking {
  patient: fhir4.Patient;
  selections: Record<string, SlotSelection>;
}

/**
 * オーダー 1 件ぶんのエントリ。予約必須の項目は、選んだ枠の予約(Appointment)と枠の
 * busy 化も同じ transaction に同梱する。オーダーと予約が atomic に成立し、登録を
 * やめれば予約も残らない。
 *
 * なお Bundle 内の Slot PUT に If-Match は付かないため、「枠を選んでから登録するまで
 * の間に他所で同じ枠が埋まる」取り合いまでは防げない(画面の予約登録と同じ許容)。
 *
 * 即実施(physioResultHelpers)も実施記録をここに足すので、分割 1 件ぶんの組み立ては
 * この関数に集約する。
 */
export function buildPhysioOrderSplitEntries(
  split: PhysioOrderSplit,
  patientId: string,
  requester: OrderContext,
  booking?: PhysioOrderBooking,
): PhysioOrderEntries {
  const selection = booking?.selections[split.key];
  if (!selection) return buildPhysioOrderEntries(split.values, patientId, requester);

  // 予約したオーダーの実施日時は予約の枠が正。行の入力値ではなく枠から写す。
  const slot = selection.slots[0];
  const built = buildPhysioOrderEntries(
    { ...split.values, authoredDate: slotDate(slot), authoredTime: slotTime(slot) },
    patientId,
    requester,
  );
  return {
    ...built,
    entries: [
      ...built.entries,
      ...buildExamAppointmentEntries(booking.patient, selection, built.headerReference),
    ],
  };
}

// 新規登録。単独オーダーの項目があれば複数のオーダーになるが、まとめて登録するので
// 1 つの transaction にする(片方だけ登録された状態を作らない)。
export function buildPhysioOrderBundle(
  values: PhysioOrderFormValues,
  patientId: string,
  requester: OrderContext,
  booking?: PhysioOrderBooking,
): fhir4.Bundle {
  return transactionBundle(
    splitPhysioOrderValues(values).flatMap(
      (split) => buildPhysioOrderSplitEntries(split, patientId, requester, booking).entries,
    ),
  );
}

// 更新は既にあるヘッダ 1 件への PUT なので分割しない(オーダーを分けたいときは
// 一度消して登録し直す)。単独の項目が他の項目と同居しないことは画面側で確かめる。
export function buildPhysioOrderUpdateBundle(
  values: PhysioOrderFormValues,
  patientId: string,
  serviceRequestId: string,
  originalItemIds: string[],
  originalResponseIds: string[],
  requester: OrderContext,
): fhir4.Bundle {
  return transactionBundle(
    buildPhysioOrderEntries(
      values,
      patientId,
      requester,
      serviceRequestId,
      originalItemIds,
      originalResponseIds,
    ).entries,
  );
}

/** オーダーとその明細、明細が参照しているテンプレート回答をまとめて消す Bundle。 */
export function buildPhysioOrderDeleteBundle(
  serviceRequestId: string,
  itemIds: string[],
  responseIds: string[] = [],
  /**
   * オーダーに紐づく検査予約の後始末(Appointment を cancelled に、押さえていた枠を
   * free に)。予約はオーダーと一心同体なので、同じ transaction で消えるまで戻す。
   */
  appointmentEntries: fhir4.BundleEntry[] = [],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      { request: { method: "DELETE", url: `ServiceRequest/${serviceRequestId}` } },
      ...itemIds.map((id) => ({
        request: { method: "DELETE" as const, url: `ServiceRequest/${id}` },
      })),
      ...responseIds.map((id) => ({
        request: { method: "DELETE" as const, url: `QuestionnaireResponse/${id}` },
      })),
      ...appointmentEntries,
    ],
  };
}

// 既存のオーダーを DO(流用)して新規登録するためのフォーム値。明細の id を落として
// 新規登録(POST)にし、実施日は当日にする。
//
// テンプレートの紐付けは外す。同じ QuestionnaireResponse を 2 つのオーダーが指すと、
// 片方で書き換えたときにもう片方の内容まで変わってしまうため。記載された文言は
// そのまま残るので、DO 先ではフリーテキストとして直せる。
export function buildDoPhysioOrderForm(
  values: PhysioOrderFormValues,
  setting: PrescriptionSetting,
): PhysioOrderFormValues {
  return {
    ...values,
    setting,
    authoredDate: today(),
    authoredTime: "",
    items: values.items.map((item) => ({
      ...item,
      id: "",
      purposeTemplate: null,
      remarksTemplate: null,
      // オーダー枠ごとの実施日時も当日から入れ直す(単独枠の入力の初期値)。
      // 至急区分は DO 元の伝票の値を引き継ぐ(同じ検査を同じ扱いで出し直すため)。
      date: today(),
      time: "",
      priority: values.priority,
    })),
  };
}

// ---- 一覧・カルテ表示のための parse ----

export interface PhysioOrderSummary {
  /** 入外区分のコード。部門一覧の絞り込みに使う(表示は settingDisplay)。 */
  settingCode: string;
  settingDisplay: string;
  priorityDisplay: string;
  /** 至急のオーダーはカードで目立たせるため、区分そのものも返す。 */
  urgent: boolean;
}

export function summarizePhysioOrder(sr: fhir4.ServiceRequest): PhysioOrderSummary {
  const setting = categoryCoding(sr, SETTING_SYSTEM);
  return {
    settingCode: setting?.code ?? "",
    settingDisplay: setting?.display ?? "",
    priorityDisplay: priorityDisplay(sr.priority),
    urgent: sr.priority === "urgent",
  };
}

/**
 * オーダーした検査(単独項目・セット・セットの構成項目をすべて含む平坦な一覧)。
 *
 * items には、そのオーダーにぶら下がる明細の ServiceRequest を渡す
 * (`_revinclude:iterate=ServiceRequest:based-on` で取得したもの)。
 */
export function physioOrderItems(
  sr: fhir4.ServiceRequest,
  items: fhir4.ServiceRequest[] = [],
): PhysioOrderItemLine[] {
  return parseItemRequests(items, sr.id);
}

/** ServiceRequest の一覧から、指定のオーダーにぶら下がる明細だけを取り出す。 */
export function physioOrderItemRequests(
  serviceRequests: fhir4.ServiceRequest[],
  headerId: string,
): fhir4.ServiceRequest[] {
  const descendants = new Set([headerId]);
  // ヘッダ → 明細 → 構成項目の 2 段。親が先に入っていないと孫を拾えないので、
  // 増えなくなるまで繰り返す(件数は数十なので素朴に回してよい)。
  for (let depth = 0; depth < 2; depth += 1) {
    for (const request of serviceRequests) {
      const parentId = parentRequestId(request);
      if (parentId && descendants.has(parentId) && request.id) descendants.add(request.id);
    }
  }
  return serviceRequests.filter(
    (request) => request.id !== headerId && descendants.has(request.id ?? ""),
  );
}

/**
 * 実施時刻(HH:mm)。時刻を指定せずにオーダーしたもの(occurrenceDateTime が
 * 日付のみ)は空。
 */
export function physioOrderTime(sr: fhir4.ServiceRequest): string {
  const occurrence = sr.occurrenceDateTime ?? "";
  return occurrence.length > 10 ? occurrence.slice(11, 16) : "";
}

export const physioOrderProblem = orderProblem;

// ---- 編集フォームへの復元 ----

export function parsePhysioOrderForm(
  sr: fhir4.ServiceRequest,
  items: fhir4.ServiceRequest[] = [],
): PhysioOrderFormValues {
  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    priority: (sr.priority === "urgent" ? "urgent" : "routine") as PhysioOrderPriority,
    authoredDate: sr.authoredOn?.slice(0, 10) ?? today(),
    authoredTime: physioOrderTime(sr),
    problem: physioOrderProblem(sr),
    items: physioOrderItems(sr, items),
  };
}
