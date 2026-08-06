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
//
// auto は「画面が既定診療科から自動で入れた値」の印。オーダー登録画面から読める
// よう既定値も保存するが、そのまま保存済みの選択として扱うと、医療従事者マスタで
// 既定診療科を変えても古い科に貼り付いてしまう。自動で入れただけの値は毎回入れ直す。
interface StoredOrderContext extends OrderContext {
  owner: string;
  auto?: boolean;
}

export interface StoredOrderContextValue extends OrderContext {
  /** 既定診療科から自動で入れた値。ユーザーが選び直したものではない。 */
  auto: boolean;
}

export function readOrderContext(owner: string): StoredOrderContextValue | null {
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
      // auto を持たない旧形式は、既定診療科から自動で入れた値と区別が付かない。
      // 既定診療科に追従する側に倒す(ユーザーが選び直せば次からは残る)。
      auto: stored.auto !== false,
    };
  } catch {
    // localStorage が使えない/壊れた値が入っている場合は既定値から始める。
    return null;
  }
}

export function storeOrderContext(owner: string, value: OrderContext, auto = false) {
  snapshot = { owner, value };
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...value, owner, auto } satisfies StoredOrderContext),
    );
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
    const stored = readOrderContext(owner);
    const { auto: _auto, ...value } = stored ?? { ...emptyOrderContext, auto: false };
    snapshot = { owner, value };
  }
  return snapshot.value;
}
