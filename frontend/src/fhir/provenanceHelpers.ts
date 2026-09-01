import { nowFhirDateTime } from "../lib/dates";

// オーダーの来歴(Provenance)。「誰が入力し、誰の指示によるものか」を、オーダー本体を
// 書き換えずに残す。医師以外のログインは代行入力になり(orderContext.ts 冒頭)、その場合
// 入力した本人と指示医師が別人になる。
//
//   agent[0] type = author   who = 指示医師(オーダーの requester)
//   agent[1] type = enterer  who = 入力した本人  onBehalfOf = 指示医師
//
// 承認まで表す場合は agent に verifier と signature[] を足す形になる(未実装)。
const AGENT_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/provenance-participant-type";

const AUTHOR = "author";
const ENTERER = "enterer";

/** 代行入力を記録する相手。ログイン中の医療従事者。 */
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

/**
 * 登録 Bundle に添える Provenance の entry。対象が取れなければ null(付けない)。
 *
 * target はオーダーのヘッダ(全ビルダーで entry[0]。新規は urn:uuid: なので transaction 内で
 * 解決される)と、同じ Bundle の MedicationRequest(処方・注射の明細)。検体検査などの明細
 * ServiceRequest は 1 オーダーで 20 件以上になりうるので入れない(ヘッダから辿れる)。
 */
export function buildOrderProvenanceEntry(
  bundle: fhir4.Bundle,
  enterer: OrderEnterer,
): fhir4.BundleEntry | null {
  const entries = bundle.entry ?? [];
  const header = entries[0];
  // 削除だけの Bundle は resource も fullUrl も持たない。
  if (!header?.fullUrl || header.resource?.resourceType !== "ServiceRequest") return null;

  const targets = [header.fullUrl];
  for (const entry of entries.slice(1)) {
    if (entry.fullUrl && entry.resource?.resourceType === "MedicationRequest") targets.push(entry.fullUrl);
  }

  // 指示医師はオーダーに実際に保存される requester をそのまま写す(OrderContext を読み直すと
  // 保存値と食い違いうる)。requester が無いオーダーは代行かどうかを判定できないので付けない。
  const requester = (header.resource as fhir4.ServiceRequest).requester;
  if (!requester?.reference) return null;

  const provenance: fhir4.Provenance = {
    resourceType: "Provenance",
    target: targets.map((reference) => ({ reference })),
    recorded: nowFhirDateTime(),
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

/** 詳細画面に出す代行入力。入力者と指示医師が同じなら null(代行ではない)。 */
export interface OrderProxyEntry {
  entererName: string;
  authorName: string;
}

export function orderProxyEntry(provenances: fhir4.Provenance[]): OrderProxyEntry | null {
  // 同じオーダーに複数あるときは最初に記録されたもの(= 登録時)を見る。
  const sorted = [...provenances].sort((a, b) => (a.recorded ?? "").localeCompare(b.recorded ?? ""));
  for (const provenance of sorted) {
    const enterer = agentOfType(provenance, ENTERER);
    const author = agentOfType(provenance, AUTHOR);
    if (!enterer?.who?.reference || !author?.who?.reference) continue;
    if (enterer.who.reference === author.who.reference) return null;

    return {
      entererName: enterer.who.display || enterer.who.reference,
      authorName: author.who.display || author.who.reference,
    };
  }
  return null;
}

/** 検索結果の Bundle から Provenance だけを取り出す。 */
export function provenancesOf(bundle: fhir4.Bundle | undefined): fhir4.Provenance[] {
  return (bundle?.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is fhir4.Provenance => resource?.resourceType === "Provenance");
}
