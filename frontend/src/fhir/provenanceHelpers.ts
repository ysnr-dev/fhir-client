import { nowFhirDateTime } from "../lib/dates";

// オーダーの来歴(Provenance)。「誰が入力し、誰の指示によるものか、指示医師が確認したか」を、
// オーダー本体を書き換えずに残す。医師以外のログインは代行入力になり(orderContext.ts 冒頭)、
// その場合入力した本人と指示医師が別人になる。
//
//   activity  CREATE(登録) / UPDATE(編集) / CANCEL(中止) …。1 回の操作 = 1 件
//   agent[0]  type = author    who = 指示医師(オーダーの requester)
//   agent[1]  type = enterer   who = 入力した本人  onBehalfOf = 指示医師
//   agent[2]  type = verifier  who = 承認した医師(承認後に足す)
//   signature 承認の電子署名(誰が・いつ。暗号署名ではなく操作の記録)
//
// 承認が要るのは「入力者 ≠ 指示医師」の活動だけ。医師本人が入力・編集した活動は承認不要
// (自分の入力を自分で確認する意味が無い)。承認は活動ごとに付くので、承認済みのオーダーを
// 代行者が編集すると、その編集ぶんだけがまた承認待ちになる。
const AGENT_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/provenance-participant-type";
const ACTIVITY_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-DataOperation";
// ASTM E1762 の署名種別。承認(内容を確認した)は Verification Signature。
const SIGNATURE_TYPE_SYSTEM = "urn:iso-astm:E1762-95:2013";
const VERIFICATION_SIGNATURE = { code: "1.2.840.10065.1.12.1.5", display: "Verification Signature" };

const AUTHOR = "author";
const ENTERER = "enterer";
const VERIFIER = "verifier";

/**
 * 活動の種類。すべて v3-DataOperation の語彙。
 *
 * 登録・編集はオーダー本体を書く操作、それ以外は**進捗(Task)や状態だけを書き換える操作**で、
 * オーダーの内容は変わらない(中止・完了・休止・再開・中止取消)。後者も指示の一部なので、
 * 代行で行われたら指示医師の承認待ちに並べる(`buildActivityProvenanceEntry`)。
 */
export type OrderActivity =
  | "CREATE"
  | "UPDATE"
  | "CANCEL"
  | "REACTIVATE"
  | "COMPLETE"
  | "SUSPEND"
  | "RESUME";

const ORDER_ACTIVITY_LABELS: Record<OrderActivity, string> = {
  CREATE: "登録",
  UPDATE: "編集",
  CANCEL: "中止",
  REACTIVATE: "中止取消",
  COMPLETE: "完了",
  SUSPEND: "休止",
  RESUME: "再開",
};

export function orderActivityLabel(activity: OrderActivity): string {
  return ORDER_ACTIVITY_LABELS[activity];
}

/** 代行入力・承認を記録する相手。ログイン中の医療従事者。 */
export interface OrderEnterer {
  practitionerId: string;
  display: string;
}

function agentType(code: string): fhir4.CodeableConcept {
  return { coding: [{ system: AGENT_TYPE_SYSTEM, code }] };
}

function agentOfType(provenance: fhir4.Provenance, code: string): fhir4.ProvenanceAgent | undefined {
  return provenance.agent?.find((agent) =>
    agent.type?.coding?.some((coding) => coding.system === AGENT_TYPE_SYSTEM && coding.code === code),
  );
}

function agentName(agent: fhir4.ProvenanceAgent | undefined): string {
  return agent?.who?.display || agent?.who?.reference || "";
}

/** 活動の種類。activity を持たない旧データは登録とみなす。 */
export function provenanceActivity(provenance: fhir4.Provenance): OrderActivity {
  const code = provenance.activity?.coding?.find((c) => c.system === ACTIVITY_SYSTEM)?.code ?? "";
  return code in ORDER_ACTIVITY_LABELS ? (code as OrderActivity) : "CREATE";
}

/** その活動が代行(入力者 ≠ 指示医師)か。どちらかが欠けていれば判定できないので false。 */
export function isProxyProvenance(provenance: fhir4.Provenance): boolean {
  const enterer = agentOfType(provenance, ENTERER)?.who?.reference;
  const author = agentOfType(provenance, AUTHOR)?.who?.reference;
  return Boolean(enterer && author && enterer !== author);
}

export function isVerifiedProvenance(provenance: fhir4.Provenance): boolean {
  return Boolean(agentOfType(provenance, VERIFIER));
}

/** 承認待ちの活動か。代行で、まだ承認されていないもの。 */
export function needsApproval(provenance: fhir4.Provenance): boolean {
  return isProxyProvenance(provenance) && !isVerifiedProvenance(provenance);
}

/** 指示医師(author)の Practitioner 参照。承認できるのはこの人だけ。 */
export function provenanceAuthorReference(provenance: fhir4.Provenance): string | undefined {
  return agentOfType(provenance, AUTHOR)?.who?.reference;
}

/** target のうち ServiceRequest の id。ヘッダと(注射の連日なら)各日のヘッダ。 */
export function provenanceServiceRequestIds(provenance: fhir4.Provenance): string[] {
  return (provenance.target ?? [])
    .map((t) => t.reference?.match(/^ServiceRequest\/(.+)$/)?.[1])
    .filter((id): id is string => Boolean(id));
}

/** Bundle の entry が指す参照。新規は fullUrl(urn:uuid:)、更新は PUT 先。 */
function entryReference(entry: fhir4.BundleEntry): string | undefined {
  if (entry.request?.method === "DELETE") return undefined;
  if (entry.fullUrl) return entry.fullUrl;
  return entry.request?.method === "PUT" ? entry.request.url : undefined;
}

/**
 * オーダーのヘッダかどうか。検体検査などの明細 ServiceRequest は basedOn でヘッダを指す
 * ので、basedOn を持たない ServiceRequest がヘッダ(注射の連日オーダーは日ごとに
 * ヘッダが並ぶ。他科依頼はテンプレート回答の entry がヘッダより前に積まれる)。
 */
export function isHeaderEntry(entry: fhir4.BundleEntry): entry is fhir4.BundleEntry & {
  resource: fhir4.ServiceRequest;
} {
  const resource = entry.resource;
  return resource?.resourceType === "ServiceRequest" && !(resource as fhir4.ServiceRequest).basedOn?.length;
}

/**
 * 登録・編集の Bundle に添える Provenance の entry。対象が取れなければ null(付けない)。
 *
 * target はオーダーのヘッダ(全部)と、同じ Bundle の MedicationRequest(処方・注射の明細)。
 * 検体検査などの明細 ServiceRequest は 1 オーダーで 20 件以上になりうるので入れない
 * (ヘッダから辿れる)。activity はヘッダが POST なら登録、PUT なら編集。
 */
export function buildOrderProvenanceEntry(
  bundle: fhir4.Bundle,
  enterer: OrderEnterer,
): fhir4.BundleEntry | null {
  const entries = bundle.entry ?? [];
  const headers = entries.filter(isHeaderEntry);
  const header = headers[0];
  // 削除だけの Bundle はヘッダの resource を持たない。
  if (!header) return null;

  const targets: string[] = [];
  for (const entry of entries) {
    if (!isHeaderEntry(entry) && entry.resource?.resourceType !== "MedicationRequest") continue;
    const reference = entryReference(entry);
    if (reference) targets.push(reference);
  }
  if (targets.length === 0) return null;

  // 指示医師はオーダーに実際に保存される requester をそのまま写す(OrderContext を読み直すと
  // 保存値と食い違いうる)。requester が無いオーダーは代行かどうかを判定できないので付けない。
  const requester = header.resource.requester;
  if (!requester?.reference) return null;

  const activity: OrderActivity = header.request?.method === "PUT" ? "UPDATE" : "CREATE";
  return provenanceEntry(targets, requester, activity, enterer);
}

/**
 * 進捗や状態だけを書き換える活動(中止・完了・休止・再開・中止取消)の来歴。
 *
 * こうした操作の Bundle は Task やヘッダの状態しか持たず、`buildOrderProvenanceEntry` が
 * 見る「登録・編集されたヘッダ」が無い。そこで**対象のオーダー(ServiceRequest)を呼ぶ側が渡す**
 * (通知の Task も患者・種別をそこから組むので、参照ではなくリソースを受け取る)。
 * target がオーダーであることは承認待ち一覧の前提でもある(行はオーダーから組む)。
 * 指示医師はオーダーに保存済みの requester をそのまま使う(登録・編集と同じ)。
 */
export function buildActivityProvenanceEntry(
  orders: fhir4.ServiceRequest[],
  activity: OrderActivity,
  enterer: OrderEnterer,
): fhir4.BundleEntry | null {
  const targets = orders.map((order) => `ServiceRequest/${order.id}`);
  const requester = orders[0]?.requester;
  if (targets.length === 0 || !requester?.reference) return null;
  return provenanceEntry(targets, requester, activity, enterer);
}

function provenanceEntry(
  targets: string[],
  requester: fhir4.Reference,
  activity: OrderActivity,
  enterer: OrderEnterer,
): fhir4.BundleEntry {
  const provenance: fhir4.Provenance = {
    resourceType: "Provenance",
    target: targets.map((reference) => ({ reference })),
    recorded: nowFhirDateTime(),
    activity: { coding: [{ system: ACTIVITY_SYSTEM, code: activity }] },
    agent: [
      { type: agentType(AUTHOR), who: requester },
      {
        type: agentType(ENTERER),
        // 氏名は保存時に display へ焼き付ける(この codebase は表示時に Practitioner を
        // 引き直さない。診療記録の作成者と同じ)。
        who: { reference: `Practitioner/${enterer.practitionerId}`, display: enterer.display || undefined },
        onBehalfOf: requester,
      },
    ],
  };

  return { fullUrl: `urn:uuid:${crypto.randomUUID()}`, resource: provenance, request: { method: "POST", url: "Provenance" } };
}

/**
 * 検査結果の確認(既読)の来歴。対象 1 件につき 1 操作 = 1 件を新しく作る。
 *
 * オーダーの承認と違い、直す対象の活動がありません(誰かの入力を承認するのではなく、
 * 出来上がった結果を読んだという記録)。agent は verifier だけで activity は持たず、
 * 署名だけが「誰がいつ読んだか」を表します。
 */
export function buildReviewProvenance(
  targetReference: string,
  reviewer: OrderEnterer,
  when: string = nowFhirDateTime(),
): fhir4.Provenance {
  const who: fhir4.Reference = {
    reference: `Practitioner/${reviewer.practitionerId}`,
    display: reviewer.display || undefined,
  };
  return {
    resourceType: "Provenance",
    target: [{ reference: targetReference }],
    recorded: when,
    agent: [{ type: agentType(VERIFIER), who }],
    signature: [{ type: [{ system: SIGNATURE_TYPE_SYSTEM, ...VERIFICATION_SIGNATURE }], when, who }],
  };
}

/** 確認の来歴の transaction entry。 */
export function reviewProvenanceEntry(provenance: fhir4.Provenance): fhir4.BundleEntry {
  return { resource: provenance, request: { method: "POST", url: "Provenance" } };
}

/** 最後の確認。誰がいつ読んだか。一度も確認されていなければ null。 */
export function latestReview(provenances: fhir4.Provenance[]): ProvenanceActor | null {
  const reviews = provenances.filter(isVerifiedProvenance).sort(byRecorded);
  const last = reviews[reviews.length - 1];
  if (!last) return null;
  const signature = last.signature?.[last.signature.length - 1];
  return {
    name: agentName(agentOfType(last, VERIFIER)),
    at: signature?.when ?? last.recorded ?? "",
  };
}

/**
 * 承認。verifier の agent と署名を足した Provenance を返す(元は変えない)。
 * 署名は「誰がいつ確認したか」の記録で、data(暗号署名)は持たない。
 */
export function buildApprovedProvenance(
  provenance: fhir4.Provenance,
  verifier: OrderEnterer,
  when: string = nowFhirDateTime(),
): fhir4.Provenance {
  const who: fhir4.Reference = {
    reference: `Practitioner/${verifier.practitionerId}`,
    display: verifier.display || undefined,
  };
  return {
    ...provenance,
    agent: [...(provenance.agent ?? []), { type: agentType(VERIFIER), who }],
    signature: [
      ...(provenance.signature ?? []),
      { type: [{ system: SIGNATURE_TYPE_SYSTEM, ...VERIFICATION_SIGNATURE }], when, who },
    ],
  };
}

/** 承認の transaction entry(PUT)。 */
export function approvalBundleEntry(approved: fhir4.Provenance): fhir4.BundleEntry {
  return { resource: approved, request: { method: "PUT", url: `Provenance/${approved.id}` } };
}

// ---- 詳細画面向けの要約 ----

export interface ProvenanceActor {
  name: string;
  /** その活動(または承認)の日時。 */
  at: string;
}

export interface OrderProvenanceSummary {
  /** 登録が代行だったとき、その入力者と指示医師。医師本人の登録なら null。 */
  proxyEntry: { entererName: string; authorName: string } | null;
  /** 登録より後の活動があれば最後のもの(編集・中止・完了…)。誰が・いつ・何を。 */
  lastUpdate: (ProvenanceActor & { activity: OrderActivity }) | null;
  /** 承認待ちの活動。空なら承認は不要か済んでいる。 */
  pending: fhir4.Provenance[];
  /** 最後の承認。承認が要る活動が一つも無ければ null。 */
  approval: ProvenanceActor | null;
  /** 承認できる人(指示医師)の Practitioner 参照。 */
  authorReference: string | undefined;
}

function byRecorded(a: fhir4.Provenance, b: fhir4.Provenance): number {
  return (a.recorded ?? "").localeCompare(b.recorded ?? "");
}

export function summarizeOrderProvenance(provenances: fhir4.Provenance[]): OrderProvenanceSummary {
  const sorted = [...provenances].sort(byRecorded);
  const creation = sorted.find((p) => provenanceActivity(p) === "CREATE") ?? sorted[0];
  // 登録より後の活動(編集・中止・完了・休止・再開)。最後の 1 件を出す。
  const updates = sorted.filter((p) => provenanceActivity(p) !== "CREATE");
  const lastUpdateProvenance = updates[updates.length - 1];

  const proxyEntry =
    creation && isProxyProvenance(creation)
      ? {
          entererName: agentName(agentOfType(creation, ENTERER)),
          authorName: agentName(agentOfType(creation, AUTHOR)),
        }
      : null;

  const lastUpdate = lastUpdateProvenance
    ? {
        name: agentName(agentOfType(lastUpdateProvenance, ENTERER)),
        at: lastUpdateProvenance.recorded ?? "",
        activity: provenanceActivity(lastUpdateProvenance),
      }
    : null;

  const pending = sorted.filter(needsApproval);
  const verified = sorted.filter((p) => isProxyProvenance(p) && isVerifiedProvenance(p));
  const lastVerified = verified[verified.length - 1];
  const lastSignature = lastVerified?.signature?.[lastVerified.signature.length - 1];
  const approval = lastVerified
    ? { name: agentName(agentOfType(lastVerified, VERIFIER)), at: lastSignature?.when ?? lastVerified.recorded ?? "" }
    : null;

  return {
    proxyEntry,
    lastUpdate,
    pending,
    approval,
    authorReference: creation ? provenanceAuthorReference(creation) : undefined,
  };
}

/** 検索結果の Bundle から Provenance だけを取り出す。 */
export function provenancesOf(bundle: fhir4.Bundle | undefined): fhir4.Provenance[] {
  return (bundle?.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is fhir4.Provenance => resource?.resourceType === "Provenance");
}
