import { today } from "../lib/dates";
import type { OrderContext } from "../orderContext";
import { buildExamAppointmentEntries, type SlotSelection } from "./appointmentHelpers";
import { slotDate, slotTime } from "./scheduleHelpers";
// FHIR dateTime へのタイムゾーン付与は診療記録と同じ変換でよいので共用する。
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { categoryCoding, displayOf, itemNumber, parentRequestId } from "./shared";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
  codingBySystem,
  type PrescriptionSetting,
} from "./prescriptionHelpers";

// 処置オーダー。生理検査と同じくオーダーヘッダは ServiceRequest で、
// 明細(処置 1 件)も 1 件ずつ独立した ServiceRequest にする。
//
//   ヘッダ ← basedOn ── 明細(単項目・セット) ← basedOn ── セットの構成項目
//
// 明細の各 ServiceRequest は、オーダーした時点の処置オーダー項目マスタの内容
// (項目コード・名称・略称)を写して持つ。マスタを直した後に過去のオーダーの
// 中身が変わってしまわないよう、参照ではなく写し。
//
// 生理検査との違い:
// - 検査種別に当たる分類軸を持たない。処置は項目名そのものが内容を表し、
//   検査室・装置のような部門内の分類軸が無いので明細の category も出さない。
// - 至急区分・依頼病名・検査目的・特別指示を持たない。オーダー画面の「選択中」枠に
//   これらの入力が無いので、priority / reason* / note / 拡張のいずれも載せない。
//   対象プロブレム(ヘッダの reasonReference)は他のオーダーと同じく持つ。
//
// オーダーの単位(GP)は「単独で選んだ処置項目 1 つ」または「セット 1 つ」。
// FHIR には検体検査のパネルと同じく、セット親と構成項目を親子の ServiceRequest で保存する。

// 処方・注射・検体検査・放射線検査・生理検査の ServiceRequest と区別するオーダー種別。
export const TREATMENT_ORDER_TYPE = { code: "treatment", display: "処置" };

// 処置オーダー項目マスタの独自コード。
const ORDER_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/treatment-order-item";
// 略称。検体検査・放射線検査と同じ CodeSystem を使う(オーダー項目の略称という意味は同じ)。
const ABBREVIATION_SYSTEM = "http://fhir-client.local/CodeSystem/lab-item-abbreviation";

// 明細の並び順。独立したリソースは検索の戻り順が保証されないため、伝票で選んだ
// 順番を明細自身に持たせる(検体検査・処方の RP 番号と同じ考え方)。
const ITEM_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/treatment-order-item-number";

/** オーダーした処置 1 件。マスタの写しなので、表示に必要な値をすべて持つ。 */
export interface TreatmentOrderItemLine {
  /** 明細の ServiceRequest の id。画面で足したばかりの項目は空(登録時に採番)。 */
  id: string;
  /** 処置オーダー項目マスタの項目コード。 */
  code: string;
  name: string;
  /** 略称。カードのように狭い場所で構成項目を並べるときに使う。 */
  shortName: string;
  /**
   * セットの構成項目としてオーダーした場合、その親(セット)の項目コード。
   * 空ならオーダー画面で単独で選んだ項目。同じ項目がセットの構成項目としても
   * 単独としても入ることはない(選択時にどちらか一方へ寄せる)。
   */
  parentCode: string;
  /**
   * 他の処置項目と同じオーダーにまとめられるか(マスタの写しではなく、登録時に
   * オーダーを分けるためだけに使う印)。false の項目は 1 件で 1 オーダーになる。
   * FHIR には出さないので、保存済みのオーダーを読んだ時点では判断できない。
   * オーダー画面が登録前にマスタから引き直して入れる。
   */
  groupable: boolean;
  /**
   * 単独オーダー枠の実施日("YYYY-MM-DD")と実施時刻("HH:mm"、任意)。
   * これらはオーダー枠(=登録される 1 オーダー)ごとの入力で、まとめ枠のぶんは
   * TreatmentOrderFormValues の同名の項目が担う。groupable と同じく登録時の分割に
   * だけ使う画面の値で、行としては FHIR に出さない(分割後にヘッダへ写る)。
   * 予約必須の項目では予約した枠の日時が入る。
   */
  date: string;
  time: string;
}

export interface TreatmentOrderFormValues {
  setting: PrescriptionSetting;
  /** 実施日。 */
  authoredDate: string;
  /**
   * 実施時刻(HH:mm)。処置の予定時刻を指定する場合だけ入れる任意入力で、
   * 空なら実施日だけのオーダー(時間帯は部門側に任せる)。
   */
  authoredTime: string;
  // 対象プロブレム(POMR)。null なら特定の問題に紐付かない処置。
  problem: ProblemRef | null;
  items: TreatmentOrderItemLine[];
}

export function emptyTreatmentOrderForm(
  problem: ProblemRef | null = null,
  setting: PrescriptionSetting = "outpatient",
): TreatmentOrderFormValues {
  return {
    setting,
    authoredDate: today(),
    authoredTime: "",
    problem,
    items: [],
  };
}

// ---- オーダーの単位(GP) ----
//
// 1 GP = 単独で選んだ処置項目 1 つ、またはセット 1 つ。セットは親を GP とし、
// 構成する処置は GP の中身として並べる(オーダー画面のプレビュー・カルテのカード・
// 詳細で共用)。

/** オーダーの 1 単位。セットなら members にその構成項目が入る。 */
export interface TreatmentOrderEntry {
  item: TreatmentOrderItemLine;
  members: TreatmentOrderItemLine[];
}

/** 単独で選んだ項目(セットを含む)。構成項目は除く。 */
export function topLevelItems(items: TreatmentOrderItemLine[]): TreatmentOrderItemLine[] {
  return items.filter((item) => !item.parentCode);
}

/** 指定したセットの構成項目。 */
export function membersOf(
  items: TreatmentOrderItemLine[],
  setCode: string,
): TreatmentOrderItemLine[] {
  return items.filter((item) => item.parentCode === setCode);
}

/** オーダーを GP(単独項目・セット)の並びにする。選んだ順のまま。 */
export function orderEntries(items: TreatmentOrderItemLine[]): TreatmentOrderEntry[] {
  return topLevelItems(items).map((item) => ({ item, members: membersOf(items, item.code) }));
}

/** GP の見出し。処置は分類軸を持たないので項目名そのもの。 */
export function entryLabel(entry: TreatmentOrderEntry): string {
  return entry.item.name;
}

// ---- FHIR リソースの組み立て ----

/** ServiceRequest が処置オーダーかどうか。他のオーダー種別との振り分けに使う。 */
export function isTreatmentServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return (sr.category ?? []).some((category) =>
    category.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === TREATMENT_ORDER_TYPE.code,
    ),
  );
}

// 明細 1 件(処置 1 つ)の ServiceRequest。親(ヘッダ、またはセット)を basedOn で指す。
// parentReference には Bundle 内の fullUrl をそのまま渡すので、新規登録では
// urn:uuid、更新では ServiceRequest/{id} になる。
function buildItemRequest(
  item: TreatmentOrderItemLine,
  sequence: number,
  patientId: string,
  authoredOn: string,
  parentReference: string,
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

  return resource;
}

function parseItemRequest(
  request: fhir4.ServiceRequest,
  parentCode: string,
): TreatmentOrderItemLine {
  const coding = request.code?.coding;
  const itemCoding = codingBySystem(coding, ORDER_ITEM_SYSTEM);
  const abbreviation = codingBySystem(coding, ABBREVIATION_SYSTEM);

  return {
    id: request.id ?? "",
    code: itemCoding?.code ?? "",
    name: itemCoding?.display ?? request.code?.text ?? "",
    shortName: abbreviation?.code ?? "",
    parentCode,
    // 保存済みのオーダーには載っていない印なので、いったんグループ化として読む。
    // 編集・DO では、登録前にオーダー画面が今のマスタから入れ直す。
    groupable: true,
    // 実施日時も明細には載らない(ヘッダが正)。編集はヘッダ 1 件への書き戻しで
    // values 側を使うので、行は既定のままでよい。
    date: "",
    time: "",
  };
}

// 明細の Bundle エントリ。既にある明細は PUT、画面で足したものは POST、
// 外した明細は DELETE(呼び出し側が元の id 一覧を渡す)。
function buildItemEntries(
  items: TreatmentOrderItemLine[],
  patientId: string,
  authoredOn: string,
  headerReference: string,
  originalItemIds: string[],
): fhir4.BundleEntry[] {
  const entries: fhir4.BundleEntry[] = [];
  const keptItemIds = new Set<string>();
  let sequence = 0;

  const pushEntry = (item: TreatmentOrderItemLine, parentReference: string): string => {
    sequence += 1;
    const fullUrl = item.id ? `ServiceRequest/${item.id}` : `urn:uuid:${crypto.randomUUID()}`;
    if (item.id) keptItemIds.add(item.id);

    entries.push({
      fullUrl,
      resource: buildItemRequest(item, sequence, patientId, authoredOn, parentReference),
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

  return entries;
}

// 明細の ServiceRequest 群を、親子の分かる 1 本の配列にする。
// requests には単独の項目・セット・セットの構成項目が混ざって届く。
function parseItemRequests(
  requests: fhir4.ServiceRequest[],
  headerId: string | undefined,
): TreatmentOrderItemLine[] {
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

function buildTreatmentOrderServiceRequest(
  values: TreatmentOrderFormValues,
  patientId: string,
  requester: OrderContext,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    // 読み出し側は system で引くので順序には依存しない。入外区分は未選択のことが
    // あるので、空の Coding(code が空文字)を作らないよう選択時だけ足す。
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...TREATMENT_ORDER_TYPE }] },
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
export interface TreatmentOrderEntries {
  /** ヘッダの ServiceRequest。即実施の Task を組み立てる元になる。 */
  header: fhir4.ServiceRequest;
  /** ヘッダを指す参照。新規登録では urn:uuid、更新では ServiceRequest/{id}。 */
  headerReference: string;
  entries: fhir4.BundleEntry[];
}

// オーダー 1 件(ヘッダ 1 + 明細 N)の Bundle エントリ。新規登録ではヘッダを
// urn:uuid で参照するので、明細の basedOn はサーバー側で採番後の id に解決される。
export function buildTreatmentOrderEntries(
  values: TreatmentOrderFormValues,
  patientId: string,
  requester: OrderContext,
  serviceRequestId?: string,
  originalItemIds: string[] = [],
): TreatmentOrderEntries {
  const headerReference = serviceRequestId
    ? `ServiceRequest/${serviceRequestId}`
    : `urn:uuid:${crypto.randomUUID()}`;
  const header = buildTreatmentOrderServiceRequest(values, patientId, requester, serviceRequestId);

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
      ),
    ],
  };
}

function transactionBundle(entry: fhir4.BundleEntry[]): fhir4.Bundle {
  return { resourceType: "Bundle", type: "transaction", entry };
}

/** 登録する 1 オーダーぶんの入力。 */
export interface TreatmentOrderSplit {
  /**
   * オーダーの識別子。まとめて登録するオーダーは空文字、単独オーダーはその項目コード
   * (単独の項目は 1 件で 1 オーダーになるので、項目コードがそのままオーダーを指す)。
   * 即実施の実施入力をオーダーごとに持たせるための添字に使う。
   */
  key: string;
  values: TreatmentOrderFormValues;
}

/**
 * 選んだ処置項目を、登録する 1 オーダーぶんずつに分ける。
 *
 * 処置室の枠を 1 件ずつ押さえる必要のあるもの(人工透析 など)は、マスタで「単独」に
 * した項目を 1 オーダー 1 処置項目にする。オーダー画面では他の項目と一度に選べるが、
 * 登録時にここで別のオーダー(別のカルテカード)へ分ける。
 *
 * 入外区分・実施日時・対象プロブレムは伝票共通の入力なので各オーダーへ写す。
 * 並びは、まとめられる項目のオーダーを先頭に、単独の項目を選んだ順。
 */
export function splitTreatmentOrderValues(
  values: TreatmentOrderFormValues,
): TreatmentOrderSplit[] {
  const groupedLines: TreatmentOrderItemLine[] = [];
  const soloOrders: TreatmentOrderSplit[] = [];

  for (const item of topLevelItems(values.items)) {
    // セットは構成項目と一緒でなければ意味がないので、必ず同じオーダーに入れる。
    const lines = [item, ...membersOf(values.items, item.code)];
    if (item.groupable) groupedLines.push(...lines);
    else {
      // 実施日時はオーダー枠ごとの入力。単独枠は行が持つ値をこのオーダーの
      // 値にする(日時が未入力なら共通値のまま)。
      soloOrders.push({
        key: item.code,
        values: {
          ...values,
          items: lines,
          authoredDate: item.date || values.authoredDate,
          authoredTime: item.date ? item.time : values.authoredTime,
        },
      });
    }
  }

  if (groupedLines.length > 0) {
    return [{ key: "", values: { ...values, items: groupedLines } }, ...soloOrders];
  }
  // 処置項目が 1 つも無い場合も呼び出し側の検証に任せ、空のオーダーを 1 件返す。
  return soloOrders.length > 0 ? soloOrders : [{ key: "", values: { ...values, items: [] } }];
}

/** 予約必須オーダーの予約内容。キーは splitTreatmentOrderValues のキー(=処置項目コード)。 */
export interface TreatmentOrderBooking {
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
 * 即実施(treatmentResultHelpers)も実施記録をここに足すので、分割 1 件ぶんの組み立ては
 * この関数に集約する。
 */
export function buildTreatmentOrderSplitEntries(
  split: TreatmentOrderSplit,
  patientId: string,
  requester: OrderContext,
  booking?: TreatmentOrderBooking,
): TreatmentOrderEntries {
  const selection = booking?.selections[split.key];
  if (!selection) return buildTreatmentOrderEntries(split.values, patientId, requester);

  // 予約したオーダーの実施日時は予約の枠が正。行の入力値ではなく枠から写す。
  const slot = selection.slots[0];
  const built = buildTreatmentOrderEntries(
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
export function buildTreatmentOrderBundle(
  values: TreatmentOrderFormValues,
  patientId: string,
  requester: OrderContext,
  booking?: TreatmentOrderBooking,
): fhir4.Bundle {
  return transactionBundle(
    splitTreatmentOrderValues(values).flatMap(
      (split) => buildTreatmentOrderSplitEntries(split, patientId, requester, booking).entries,
    ),
  );
}

// 更新は既にあるヘッダ 1 件への PUT なので分割しない(オーダーを分けたいときは
// 一度消して登録し直す)。単独の項目が他の項目と同居しないことは画面側で確かめる。
export function buildTreatmentOrderUpdateBundle(
  values: TreatmentOrderFormValues,
  patientId: string,
  serviceRequestId: string,
  originalItemIds: string[],
  requester: OrderContext,
): fhir4.Bundle {
  return transactionBundle(
    buildTreatmentOrderEntries(values, patientId, requester, serviceRequestId, originalItemIds)
      .entries,
  );
}

/** オーダーとその明細をまとめて消す Bundle。 */
export function buildTreatmentOrderDeleteBundle(
  serviceRequestId: string,
  itemIds: string[],
  /**
   * オーダーに紐づく処置予約の後始末(Appointment を cancelled に、押さえていた枠を
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
      ...appointmentEntries,
    ],
  };
}

// 既存のオーダーを DO(流用)して新規登録するためのフォーム値。明細の id を落として
// 新規登録(POST)にし、実施日は当日にする。
export function buildDoTreatmentOrderForm(
  values: TreatmentOrderFormValues,
  setting: PrescriptionSetting,
): TreatmentOrderFormValues {
  return {
    ...values,
    setting,
    authoredDate: today(),
    authoredTime: "",
    items: values.items.map((item) => ({
      ...item,
      id: "",
      // オーダー枠ごとの実施日時も当日から入れ直す(単独枠の入力の初期値)。
      date: today(),
      time: "",
    })),
  };
}

// ---- 一覧・カルテ表示のための parse ----

export interface TreatmentOrderSummary {
  /** 入外区分のコード。部門一覧の絞り込みに使う(表示は settingDisplay)。 */
  settingCode: string;
  settingDisplay: string;
}

export function summarizeTreatmentOrder(sr: fhir4.ServiceRequest): TreatmentOrderSummary {
  const setting = categoryCoding(sr, SETTING_SYSTEM);
  return {
    settingCode: setting?.code ?? "",
    settingDisplay: setting?.display ?? "",
  };
}

/**
 * オーダーした処置(単独項目・セット・セットの構成項目をすべて含む平坦な一覧)。
 *
 * items には、そのオーダーにぶら下がる明細の ServiceRequest を渡す
 * (`_revinclude:iterate=ServiceRequest:based-on` で取得したもの)。
 */
export function treatmentOrderItems(
  sr: fhir4.ServiceRequest,
  items: fhir4.ServiceRequest[] = [],
): TreatmentOrderItemLine[] {
  return parseItemRequests(items, sr.id);
}

/** ServiceRequest の一覧から、指定のオーダーにぶら下がる明細だけを取り出す。 */
export function treatmentOrderItemRequests(
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
export function treatmentOrderTime(sr: fhir4.ServiceRequest): string {
  const occurrence = sr.occurrenceDateTime ?? "";
  return occurrence.length > 10 ? occurrence.slice(11, 16) : "";
}

export const treatmentOrderProblem = orderProblem;

// ---- 編集フォームへの復元 ----

export function parseTreatmentOrderForm(
  sr: fhir4.ServiceRequest,
  items: fhir4.ServiceRequest[] = [],
): TreatmentOrderFormValues {
  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    authoredDate: sr.authoredOn?.slice(0, 10) ?? today(),
    authoredTime: treatmentOrderTime(sr),
    problem: treatmentOrderProblem(sr),
    items: treatmentOrderItems(sr, items),
  };
}
