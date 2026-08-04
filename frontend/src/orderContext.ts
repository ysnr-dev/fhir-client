// カルテ画面ヘッダーで選ぶ「依頼科・依頼医師」。オーダー(処方など)を登録する
// ときの依頼元として使う想定で、ログインしている医療従事者ごとに保存する。
//
//   医師・歯科医師のログイン … 依頼医師は本人。依頼科だけを選ぶ。
//   それ以外のログイン      … 代行入力。依頼科と指示医師の両方を選ぶ。
export interface OrderContext {
  /** 依頼科(診療科 Organization.id)。 */
  departmentId: string;
  departmentName: string;
  /** 依頼医師(Practitioner.id)。代行入力では指示医師を選ぶまで空。 */
  practitionerId: string;
  practitionerName: string;
}

export const emptyOrderContext: OrderContext = {
  departmentId: "",
  departmentName: "",
  practitionerId: "",
  practitionerName: "",
};

const STORAGE_KEY = "fhir-client.karte.orderContext";

// 別のユーザーでログインし直したときに前のユーザーの選択を引き継がないよう、
// 保存時のログイン医療従事者(owner)も一緒に持たせて読み出し時に突き合わせる。
interface StoredOrderContext extends OrderContext {
  owner: string;
}

export function readOrderContext(owner: string): OrderContext | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredOrderContext>;
    if (!stored || stored.owner !== owner) return null;
    return {
      departmentId: stored.departmentId ?? "",
      departmentName: stored.departmentName ?? "",
      practitionerId: stored.practitionerId ?? "",
      practitionerName: stored.practitionerName ?? "",
    };
  } catch {
    // localStorage が使えない/壊れた値が入っている場合は既定値から始める。
    return null;
  }
}

export function storeOrderContext(owner: string, value: OrderContext) {
  snapshot = { owner, value };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...value, owner } satisfies StoredOrderContext));
  } catch {
    // 保存できなくてもその場の選択は有効にする。
  }
  for (const listener of listeners) listener();
}

// ---- 参照側(オーダー登録画面)------------------------------------------------
//
// ヘッダーの選択を処方などの登録画面から読むための購読口。localStorage を都度
// 読むと毎回別オブジェクトになり useSyncExternalStore が無限ループするため、
// 最新値をメモリにも持って同じ参照を配る。

let snapshot: { owner: string; value: OrderContext } | null = null;
const listeners = new Set<() => void>();

export function subscribeOrderContext(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** ログイン中の医療従事者 owner が選んでいる依頼科・依頼医師(未選択なら空)。 */
export function orderContextSnapshot(owner: string): OrderContext {
  if (!snapshot || snapshot.owner !== owner) {
    snapshot = { owner, value: readOrderContext(owner) ?? emptyOrderContext };
  }
  return snapshot.value;
}
