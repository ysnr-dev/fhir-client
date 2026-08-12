import type { OrderContext } from "../orderContext";
// FHIR dateTime へのタイムゾーン付与は診療記録と同じ変換でよいので共用する。
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { problemRefFromReference, type ProblemRef } from "./conditionHelpers";
import type { TemplateBinding } from "./questionnaireResponseHelpers";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
  codingBySystem,
  type PrescriptionSetting,
} from "./prescriptionHelpers";

// 放射線検査オーダー。検体検査と同じくオーダーヘッダは ServiceRequest で、
// 明細(撮影 1 件)も 1 件ずつ独立した ServiceRequest にする。
//
//   ヘッダ ← basedOn ── 明細(単項目・セット) ← basedOn ── セットの構成項目
//
// 明細の各 ServiceRequest は、オーダーした時点の放射線オーダー項目マスタの内容
// (項目コード・名称・略称・JJ1017 コード・種別・部位・左右)を写して持つ。
// マスタを直した後に過去のオーダーの中身が変わってしまわないよう、参照ではなく写し。
//
// JJ1017 の載せ方:
// - 32桁コードは JJ1017-32 として code.coding に入れる(これが復元の唯一の元)。
//   併せて JJ1017-16M / JJ1017-16S も入れる。DICOM の符号値は 16 バイト上限で、
//   受け手の RIS は前半(16M)を予約済みプロトコル符号シーケンス、後半(16S)を
//   プロトコル コンテキスト シーケンスに載せ替えるため(JJ1017指針 4.2 / 5.2)。
// - 部位・左右は bodySite にも出す。JP Core の ImagingStudy Radiology Profile が
//   bodySite / laterality に「JJ1017P の小部位コード・左右コードの利用を許容する」と
//   しており、同時に「JJ1017 は手技のほか部位・左右も含むので bodySite・laterality との
//   整合に注意」と述べている。32桁コードと同じ値をそのまま出すことで整合させる。
// - 種別(モダリティ)は明細の category に出す。撮影室・装置の単位。
//
// オーダーの単位(GP)は「単独で選んだ撮影項目 1 つ」または「セット 1 つ」。
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
//
// JJ1017 には FHIR 用の公式な system URI が無い(JP Core も定義していない)ため、
// 他のローカルコードと同じ fhir-client.local の URI を使い、末尾は JJ1017 指針が
// 定める符号化系指定子(JJ1017-32 / JJ1017-16M / JJ1017-16S / JJ1017P)に合わせる。

// 処方・注射・検体検査の ServiceRequest と区別するオーダー種別。
export const RAD_ORDER_TYPE = { code: "rad", display: "放射線検査" };

// 放射線オーダー項目マスタの独自コード。
const ORDER_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/rad-order-item";
// JJ1017 の 32 桁コードと、その前半・後半(DICOM 連携で使う分割)。
const JJ1017_32_SYSTEM = "http://fhir-client.local/CodeSystem/jj1017-32";
const JJ1017_16M_SYSTEM = "http://fhir-client.local/CodeSystem/jj1017-16m";
const JJ1017_16S_SYSTEM = "http://fhir-client.local/CodeSystem/jj1017-16s";
// JJ1017 の部位(小部位)。指針 5.5 が独立コードとしての符号化系指定子を JJ1017P と定める。
const JJ1017P_SYSTEM = "http://fhir-client.local/CodeSystem/jj1017p";
// 左右等・種別(モダリティ)。JJ1017 は独立コードとしての指定子を定めていないので独自に付ける。
const JJ1017_LATERALITY_SYSTEM = "http://fhir-client.local/CodeSystem/jj1017-laterality";
const JJ1017_MODALITY_SYSTEM = "http://fhir-client.local/CodeSystem/jj1017-modality";
// 略称。検体検査と同じ CodeSystem を使う(検査項目の略称という意味は同じ)。
const ABBREVIATION_SYSTEM = "http://fhir-client.local/CodeSystem/lab-item-abbreviation";
// 検査目的。標準要素に当てはまるものが無いのでローカル拡張で持つ。
const EXAM_PURPOSE_EXT_URL = "http://fhir-client.local/StructureDefinition/rad-exam-purpose";
// テンプレートから記載したときの記入内容(QuestionnaireResponse)への参照。
// 命名は診療記録の clinical-note-section-questionnaire-response に合わせる。
const PURPOSE_QR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/rad-exam-purpose-questionnaire-response";
const REMARKS_QR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/rad-remarks-questionnaire-response";

// 明細の並び順。独立したリソースは検索の戻り順が保証されないため、伝票で選んだ
// 順番を明細自身に持たせる(検体検査・処方の RP 番号と同じ考え方)。
const ITEM_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/rad-order-item-number";

const JJ1017_CODE_LENGTH = 32;
const JJ1017_16M_LENGTH = 16;

export type RadOrderPriority = "routine" | "urgent";

export const PRIORITY_OPTIONS: { code: RadOrderPriority; display: string }[] = [
  { code: "routine", display: "通常" },
  { code: "urgent", display: "至急" },
];

/** オーダーした撮影 1 件。マスタの写しなので、表示に必要な値をすべて持つ。 */
export interface RadOrderItemLine {
  /** 明細の ServiceRequest の id。画面で足したばかりの項目は空(登録時に採番)。 */
  id: string;
  /** 放射線オーダー項目マスタの項目コード。 */
  code: string;
  name: string;
  /** 略称。カードのように狭い場所で構成項目を並べるときに使う。 */
  shortName: string;
  /** JJ1017-32(32桁)。要素をすべて未設定でオーダーした項目は空。 */
  jj1017Code: string;
  /** 種別(モダリティ)。オーダー内容をまとめて見せる軸。 */
  modalityCode: string;
  modalityName: string;
  bodyPartCode: string;
  bodyPartName: string;
  lateralityCode: string;
  lateralityName: string;
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
}

export interface RadOrderFormValues {
  setting: PrescriptionSetting;
  priority: RadOrderPriority;
  /** 撮影日。 */
  authoredDate: string;
  /**
   * 撮影時刻(HH:mm)。撮影の予定時刻を指定する場合だけ入れる任意入力で、
   * 空なら撮影日だけのオーダー(時間帯は撮影側に任せる)。
   */
  authoredTime: string;
  /** 依頼コメント(臨床情報・読影依頼事項)。 */
  comment: string;
  // 対象プロブレム(POMR)。null なら特定の問題に紐付かない検査。
  problem: ProblemRef | null;
  items: RadOrderItemLine[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyRadOrderForm(problem: ProblemRef | null = null): RadOrderFormValues {
  return {
    setting: "outpatient",
    priority: "routine",
    authoredDate: today(),
    authoredTime: "",
    comment: "",
    problem,
    items: [],
  };
}

function displayOf<T extends { code: string; display: string }>(options: T[], code: string): string {
  return options.find((o) => o.code === code)?.display ?? code;
}

export function priorityDisplay(priority: string | undefined): string {
  return priority ? displayOf(PRIORITY_OPTIONS, priority) : "";
}

/** 撮影部位の表示(「右 膝関節」)。左右指定なしの部位は部位名だけ。 */
export function bodySiteLabel(item: RadOrderItemLine): string {
  return [item.lateralityName, item.bodyPartName].filter(Boolean).join(" ");
}

// ---- オーダーの単位(GP) ----
//
// 1 GP = 単独で選んだ撮影項目 1 つ、またはセット 1 つ。セットは親を GP とし、
// 構成する撮影は GP の中身として並べる(オーダー画面のプレビュー・カルテのカード・
// 詳細で共用)。

/** オーダーの 1 単位。セットなら members にその構成項目が入る。 */
export interface RadOrderEntry {
  item: RadOrderItemLine;
  members: RadOrderItemLine[];
}

/** 単独で選んだ項目(セットを含む)。構成項目は除く。 */
export function topLevelItems(items: RadOrderItemLine[]): RadOrderItemLine[] {
  return items.filter((item) => !item.parentCode);
}

/** 指定したセットの構成項目。 */
export function membersOf(items: RadOrderItemLine[], setCode: string): RadOrderItemLine[] {
  return items.filter((item) => item.parentCode === setCode);
}

/** オーダーを GP(単独項目・セット)の並びにする。選んだ順のまま。 */
export function orderEntries(items: RadOrderItemLine[]): RadOrderEntry[] {
  return topLevelItems(items).map((item) => ({ item, members: membersOf(items, item.code) }));
}

/** GP の種別(モダリティ)。セットは自身に種別を持たないので構成項目から採る。 */
export function entryModalityName(entry: RadOrderEntry): string {
  return entry.item.modalityName || entry.members[0]?.modalityName || "";
}

/** GP の見出し(「Ｘ線単純撮影 | 頭部単純Ｘ線 2方向」)。区切りはカードの見出し・
 *  メタ行(「外来 | 内科 | 児玉 義憲」)と同じ縦棒に揃える。 */
export function entryLabel(entry: RadOrderEntry): string {
  return [entryModalityName(entry), entry.item.name].filter(Boolean).join(" | ");
}

// ---- FHIR リソースの組み立て ----

/** ServiceRequest が放射線検査オーダーかどうか。処方・注射・検体検査との振り分けに使う。 */
export function isRadServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return (sr.category ?? []).some((category) =>
    category.coding?.some((c) => c.system === ORDER_TYPE_SYSTEM && c.code === RAD_ORDER_TYPE.code),
  );
}

// 要素をすべて未設定でオーダーした項目は 32 桁すべてが 0 になる。意味のある
// コードだけを FHIR に出したいので、その場合はコード無しとして扱う。
function hasJj1017Code(code: string): boolean {
  return code.length === JJ1017_CODE_LENGTH && /[^0]/.test(code);
}

// 明細 1 件(撮影 1 つ)の ServiceRequest。親(ヘッダ、またはセット)を basedOn で指す。
// parentReference には Bundle 内の fullUrl をそのまま渡すので、新規登録では
// urn:uuid、更新では ServiceRequest/{id} になる。
function buildItemRequest(
  item: RadOrderItemLine,
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
  if (hasJj1017Code(item.jj1017Code)) {
    coding.push(
      { system: JJ1017_32_SYSTEM, code: item.jj1017Code, display: item.name },
      // DICOM は符号値が 16 バイトまでなので、受け手が載せ替えやすいよう分割も添える。
      { system: JJ1017_16M_SYSTEM, code: item.jj1017Code.slice(0, JJ1017_16M_LENGTH) },
      { system: JJ1017_16S_SYSTEM, code: item.jj1017Code.slice(JJ1017_16M_LENGTH) },
    );
  }
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

  if (item.modalityCode) {
    resource.category = [
      {
        coding: [
          {
            system: JJ1017_MODALITY_SYSTEM,
            code: item.modalityCode,
            display: item.modalityName || undefined,
          },
        ],
        text: item.modalityName || undefined,
      },
    ];
  }

  const bodySite = buildBodySite(item);
  if (bodySite) resource.bodySite = [bodySite];

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
export function radOrderResponseIds(itemRequests: fhir4.ServiceRequest[]): string[] {
  return itemRequests.flatMap((request) =>
    [responseIdOf(request, PURPOSE_QR_EXT_URL), responseIdOf(request, REMARKS_QR_EXT_URL)].filter(
      (id): id is string => Boolean(id),
    ),
  );
}

// 撮影部位。32桁コードの部位・左右と同じ値を、FHIR の bodySite としても読めるようにする。
function buildBodySite(item: RadOrderItemLine): fhir4.CodeableConcept | undefined {
  if (!item.bodyPartCode && !item.lateralityCode) return undefined;

  const coding: fhir4.Coding[] = [];
  if (item.bodyPartCode) {
    coding.push({
      system: JJ1017P_SYSTEM,
      code: item.bodyPartCode,
      display: item.bodyPartName || undefined,
    });
  }
  if (item.lateralityCode) {
    coding.push({
      system: JJ1017_LATERALITY_SYSTEM,
      code: item.lateralityCode,
      display: item.lateralityName || undefined,
    });
  }

  return { coding, text: bodySiteLabel(item) || undefined };
}

function categoryCodingOf(
  resource: fhir4.ServiceRequest,
  system: string,
): fhir4.Coding | undefined {
  for (const category of resource.category ?? []) {
    const coding = codingBySystem(category.coding, system);
    if (coding) return coding;
  }
  return undefined;
}

function bindingOf(responseId: string | null): TemplateBinding | null {
  return responseId ? { responseId, draft: null } : null;
}

function parseItemRequest(request: fhir4.ServiceRequest, parentCode: string): RadOrderItemLine {
  const coding = request.code?.coding;
  const itemCoding = codingBySystem(coding, ORDER_ITEM_SYSTEM);
  const abbreviation = codingBySystem(coding, ABBREVIATION_SYSTEM);
  const modality = categoryCodingOf(request, JJ1017_MODALITY_SYSTEM);
  const bodySite = request.bodySite?.[0]?.coding;
  const bodyPart = codingBySystem(bodySite, JJ1017P_SYSTEM);
  const laterality = codingBySystem(bodySite, JJ1017_LATERALITY_SYSTEM);
  const reasonReference = request.reasonReference?.find((r) =>
    r.reference?.startsWith("Condition/"),
  );

  return {
    id: request.id ?? "",
    code: itemCoding?.code ?? "",
    name: itemCoding?.display ?? request.code?.text ?? "",
    shortName: abbreviation?.code ?? "",
    jj1017Code: codingBySystem(coding, JJ1017_32_SYSTEM)?.code ?? "",
    modalityCode: modality?.code ?? "",
    modalityName: modality?.display ?? "",
    bodyPartCode: bodyPart?.code ?? "",
    bodyPartName: bodyPart?.display ?? "",
    lateralityCode: laterality?.code ?? "",
    lateralityName: laterality?.display ?? "",
    reasonConditionId: reasonReference?.reference?.split("/").pop() ?? "",
    reasonName: reasonReference?.display ?? request.reasonCode?.[0]?.text ?? "",
    purpose: request.extension?.find((e) => e.url === EXAM_PURPOSE_EXT_URL)?.valueString ?? "",
    remarks: request.note?.[0]?.text ?? "",
    // draft は null = 「再編集されるまで回答は触らない」(診療記録と同じ)。
    purposeTemplate: bindingOf(responseIdOf(request, PURPOSE_QR_EXT_URL)),
    remarksTemplate: bindingOf(responseIdOf(request, REMARKS_QR_EXT_URL)),
    parentCode,
  };
}

// 明細の Bundle エントリ。既にある明細は PUT、画面で足したものは POST、
// 外した明細は DELETE(呼び出し側が元の id 一覧を渡す)。
// テンプレート記入内容(QuestionnaireResponse)も同じ Bundle に積み、参照が外れた
// 回答は DELETE する(本体を保存しなかったときに回答だけ残る孤児を作らない)。
function buildItemEntries(
  items: RadOrderItemLine[],
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

  const pushEntry = (item: RadOrderItemLine, parentReference: string): string => {
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

function itemNumber(request: fhir4.ServiceRequest): number {
  const value = request.identifier?.find((i) => i.system === ITEM_NUMBER_SYSTEM)?.value;
  return value ? Number(value) : 0;
}

// 明細の ServiceRequest 群を、親子の分かる 1 本の配列にする。
// requests には単独の項目・セット・セットの構成項目が混ざって届く。
function parseItemRequests(
  requests: fhir4.ServiceRequest[],
  headerId: string | undefined,
): RadOrderItemLine[] {
  // 明細の id → 項目コード。構成項目に親のコードを持たせる。
  const codeById = new Map<string, string>();
  for (const request of requests) {
    const code = codingBySystem(request.code?.coding, ORDER_ITEM_SYSTEM)?.code;
    if (request.id && code) codeById.set(request.id, code);
  }

  return [...requests]
    .sort((a, b) => itemNumber(a) - itemNumber(b))
    .map((request) => {
      const parentId = request.basedOn?.[0]?.reference?.split("/").pop() ?? "";
      // ヘッダを指しているものは単独で選んだ項目(親コードなし)。
      const parentCode = parentId === headerId ? "" : (codeById.get(parentId) ?? "");
      return parseItemRequest(request, parentCode);
    });
}

function buildRadOrderServiceRequest(
  values: RadOrderFormValues,
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
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...RAD_ORDER_TYPE }] },
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
    // 撮影日時。オーダー日と同じ日を入れる(撮影日として 1 つだけ入力する)。
    // 撮影時刻を指定したときだけ時刻まで入れる(FHIR の dateTime は時刻を持つなら
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
  if (values.comment) {
    resource.note = [{ text: values.comment }];
  }

  return resource;
}

// ヘッダ 1 件 + 明細 N 件の transaction Bundle。新規登録ではヘッダを urn:uuid で
// 参照するので、明細の basedOn はサーバー側で採番後の id に解決される。
function buildRadOrderTransactionBundle(
  values: RadOrderFormValues,
  patientId: string,
  requester: OrderContext,
  serviceRequestId?: string,
  originalItemIds: string[] = [],
  originalResponseIds: string[] = [],
): fhir4.Bundle {
  const headerReference = serviceRequestId
    ? `ServiceRequest/${serviceRequestId}`
    : `urn:uuid:${crypto.randomUUID()}`;

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        fullUrl: headerReference,
        resource: buildRadOrderServiceRequest(values, patientId, requester, serviceRequestId),
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

export function buildRadOrderBundle(
  values: RadOrderFormValues,
  patientId: string,
  requester: OrderContext,
): fhir4.Bundle {
  return buildRadOrderTransactionBundle(values, patientId, requester);
}

export function buildRadOrderUpdateBundle(
  values: RadOrderFormValues,
  patientId: string,
  serviceRequestId: string,
  originalItemIds: string[],
  originalResponseIds: string[],
  requester: OrderContext,
): fhir4.Bundle {
  return buildRadOrderTransactionBundle(
    values,
    patientId,
    requester,
    serviceRequestId,
    originalItemIds,
    originalResponseIds,
  );
}

/** オーダーとその明細、明細が参照しているテンプレート回答をまとめて消す Bundle。 */
export function buildRadOrderDeleteBundle(
  serviceRequestId: string,
  itemIds: string[],
  responseIds: string[] = [],
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
    ],
  };
}

// 既存のオーダーを DO(流用)して新規登録するためのフォーム値。明細の id を落として
// 新規登録(POST)にし、撮影日は当日にする。
//
// テンプレートの紐付けは外す。同じ QuestionnaireResponse を 2 つのオーダーが指すと、
// 片方で書き換えたときにもう片方の内容まで変わってしまうため。記載された文言は
// そのまま残るので、DO 先ではフリーテキストとして直せる。
export function buildDoRadOrderForm(values: RadOrderFormValues): RadOrderFormValues {
  return {
    ...values,
    authoredDate: today(),
    items: values.items.map((item) => ({
      ...item,
      id: "",
      purposeTemplate: null,
      remarksTemplate: null,
    })),
  };
}

// ---- 一覧・カルテ表示のための parse ----

export interface RadOrderSummary {
  settingDisplay: string;
  priorityDisplay: string;
  /** 至急のオーダーはカードで目立たせるため、区分そのものも返す。 */
  urgent: boolean;
}

export function summarizeRadOrder(sr: fhir4.ServiceRequest): RadOrderSummary {
  return {
    settingDisplay: categoryCodingOf(sr, SETTING_SYSTEM)?.display ?? "",
    priorityDisplay: priorityDisplay(sr.priority),
    urgent: sr.priority === "urgent",
  };
}

/**
 * オーダーした撮影(単独項目・セット・セットの構成項目をすべて含む平坦な一覧)。
 *
 * items には、そのオーダーにぶら下がる明細の ServiceRequest を渡す
 * (`_revinclude:iterate=ServiceRequest:based-on` で取得したもの)。
 */
export function radOrderItems(
  sr: fhir4.ServiceRequest,
  items: fhir4.ServiceRequest[] = [],
): RadOrderItemLine[] {
  return parseItemRequests(items, sr.id);
}

/** ServiceRequest の一覧から、指定のオーダーにぶら下がる明細だけを取り出す。 */
export function radOrderItemRequests(
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

function parentRequestId(sr: fhir4.ServiceRequest): string | undefined {
  const reference = sr.basedOn?.[0]?.reference;
  return reference?.startsWith("ServiceRequest/") ? reference.split("/")[1] : undefined;
}

export function radOrderComment(sr: fhir4.ServiceRequest): string {
  return sr.note?.[0]?.text ?? "";
}

/**
 * 撮影時刻(HH:mm)。時刻を指定せずにオーダーしたもの(occurrenceDateTime が
 * 日付のみ)は空。
 */
export function radOrderTime(sr: fhir4.ServiceRequest): string {
  const occurrence = sr.occurrenceDateTime ?? "";
  return occurrence.length > 10 ? occurrence.slice(11, 16) : "";
}

export function radOrderProblem(sr: fhir4.ServiceRequest | undefined): ProblemRef | null {
  for (const reference of sr?.reasonReference ?? []) {
    const problem = problemRefFromReference(reference);
    if (problem) return problem;
  }
  return null;
}

// ---- 編集フォームへの復元 ----

export function parseRadOrderForm(
  sr: fhir4.ServiceRequest,
  items: fhir4.ServiceRequest[] = [],
): RadOrderFormValues {
  return {
    setting: (categoryCodingOf(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    priority: (sr.priority === "urgent" ? "urgent" : "routine") as RadOrderPriority,
    authoredDate: sr.authoredOn?.slice(0, 10) ?? today(),
    authoredTime: radOrderTime(sr),
    comment: radOrderComment(sr),
    problem: radOrderProblem(sr),
    items: radOrderItems(sr, items),
  };
}
