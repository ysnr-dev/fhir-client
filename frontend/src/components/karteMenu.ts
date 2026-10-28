import type { ProblemRef } from "../fhir/conditionHelpers";
import type { KartePaneState } from "./KarteRightPane";

// カルテ右ペインの新規登録メニューの一覧。頻用設定はキーで保存する(backend の karte_pane_favorites)。
// 右ペインを開かずにその場で行う操作(患者呼出)も同じ一覧に載せ、頻用に選べるようにする。

export interface KarteMenuItem {
  /** 頻用設定に保存するキー。変えると保存済みの頻用から外れる。 */
  key: string;
  label: string;
  /** 見出しの下に畳むときの見出し(「全て」での表示だけに使う)。 */
  group?: string;
  /** 見出しから外して並べるときの名前(頻用・頻用設定)。無ければ label。 */
  fullLabel?: string;
  /** 右ペインで開く登録。action の項目には無い。 */
  open?: (problem: ProblemRef | undefined) => KartePaneState;
  /** 右ペインを開かずに行う操作。 */
  action?: "patient-call";
}

// 「全て」の並び順。メニューを足したら 1 要素足す。
export const KARTE_MENU_ITEMS: KarteMenuItem[] = [
  { key: "note", label: "診療記録", open: (problem) => ({ kind: "note-create", problem }) },
  { key: "vital", label: "バイタル", open: (problem) => ({ kind: "vital-create", problem }) },
  { key: "template", label: "テンプレート", open: (problem) => ({ kind: "qr-create", problem }) },
  // 文書作成も記録を書く入口なので、テンプレートの隣に置く。
  { key: "document", label: "文書作成", open: () => ({ kind: "document-create" }) },
  { key: "appointment", label: "予約", open: (problem) => ({ kind: "appointment-create", problem }) },
  // 入院予定も先の日を押さえる操作なので、予約の隣に置く。
  { key: "planned-admission", label: "入院予定", open: () => ({ kind: "planned-admission-create" }) },
  // よく出すオーダーをまとめて出す入口。個別の種別ボタンより前に置く
  // (「セットにあればセット、無ければ個別」の順で探すため)。
  { key: "order-set", label: "セット", open: (problem) => ({ kind: "order-set", problem }) },
  { key: "prescription", label: "処方", open: (problem) => ({ kind: "prescription-create", problem }) },
  { key: "injection", label: "注射", open: (problem) => ({ kind: "injection-create", problem }) },
  // レジメン(化学療法)の適用。注射・処方に展開されるので、その隣に置く。
  { key: "regimen", label: "化学療法", open: (problem) => ({ kind: "regimen-apply", problem }) },
  // 放射線治療の治療処方(放射線治療医が書く)。化学療法と同じくがんの治療計画なので
  // 隣に置く。臨床医からの依頼は下の「他科依頼」で出す。
  {
    key: "radiotherapy-order",
    label: "放射線治療",
    open: (problem) => ({ kind: "radiotherapy-order-create", problem }),
  },
  // クリニカルパスの適用。入院の計画そのものなので、化学療法の隣に置く。
  { key: "pathway", label: "クリニカルパス", open: () => ({ kind: "pathway-apply" }) },
  { key: "lab-order", label: "検体検査", open: (problem) => ({ kind: "lab-order-create", problem }) },
  { key: "micro-order", label: "細菌検査", open: (problem) => ({ kind: "micro-order-create", problem }) },
  { key: "patho-order", label: "病理検査", open: (problem) => ({ kind: "patho-order-create", problem }) },
  { key: "rad-order", label: "放射線検査", open: (problem) => ({ kind: "rad-order-create", problem }) },
  { key: "physio-order", label: "生理検査", open: (problem) => ({ kind: "physio-order-create", problem }) },
  { key: "endoscopy-order", label: "内視鏡", open: (problem) => ({ kind: "endoscopy-order-create", problem }) },
  { key: "treatment-order", label: "処置", open: (problem) => ({ kind: "treatment-order-create", problem }) },
  { key: "surgery-order", label: "手術", open: (problem) => ({ kind: "surgery-order-create", problem }) },
  { key: "meal-order", label: "食事", open: (problem) => ({ kind: "meal-order-create", problem }) },
  { key: "transfusion-order", label: "輸血", open: (problem) => ({ kind: "transfusion-order-create", problem }) },
  { key: "rehab-order", label: "リハビリ", open: (problem) => ({ kind: "rehab-order-create", problem }) },
  {
    key: "nutrition-guidance-order",
    label: "栄養指導",
    open: (problem) => ({ kind: "nutrition-guidance-order-create", problem }),
  },
  {
    key: "medication-guidance-order",
    label: "服薬指導",
    open: (problem) => ({ kind: "medication-guidance-order-create", problem }),
  },
  // 看護過程の順(情報収集 → 計画 → 指示 → サマリー)に並べる。見出し「看護」の下では
  // 「看護」を付けない(列の幅は最長のラベルで決まる)。
  {
    key: "nursing-profile",
    label: "プロファイル",
    group: "看護",
    fullLabel: "看護プロファイル",
    open: () => ({ kind: "nursing-profile" }),
  },
  {
    key: "nursing-plan",
    label: "看護計画",
    group: "看護",
    open: () => ({ kind: "nursing-problem-create", entry: "standard_plan" }),
  },
  {
    key: "nursing-diagnosis",
    label: "看護診断",
    group: "看護",
    open: () => ({ kind: "nursing-problem-create", entry: "diagnosis" }),
  },
  {
    key: "nursing-order",
    label: "看護指示",
    group: "看護",
    open: (problem) => ({ kind: "nursing-order-create", problem }),
  },
  { key: "nursing-summary", label: "看護サマリー", group: "看護", open: () => ({ kind: "nursing-summary-create" }) },
  // 他科依頼は部門ではなく人(他の診療科の医師)への依頼なので、部門オーダーを並べた最後に置く。
  { key: "consult-order", label: "他科依頼", open: (problem) => ({ kind: "consult-order-create", problem }) },
  // チーム依頼(NST・ICT・褥瘡対策など)も人への依頼なので他科依頼の隣。
  { key: "team-request", label: "チーム依頼", open: (problem) => ({ kind: "team-request-create", problem }) },
  // 退院時サマリーは入院の締めくくりに書く文書なので、下に置く。
  { key: "discharge-summary", label: "退院時サマリー", open: () => ({ kind: "summary-create" }) },
  { key: "dpc", label: "DPC", open: () => ({ kind: "dpc-form1-create" }) },
  // 待合表示板への呼出。待合表示板を使っていない施設ではボタンが出ない。
  { key: "patient-call", label: "患者呼出", action: "patient-call" },
];

const ITEM_BY_KEY = new Map(KARTE_MENU_ITEMS.map((item) => [item.key, item]));

export function karteMenuFullLabel(item: KarteMenuItem): string {
  return item.fullLabel ?? item.label;
}

/** 保存済みのキーを表示順のメニューに戻す。今は無いキーは落とす。 */
export function karteMenuItemsOf(keys: string[]): KarteMenuItem[] {
  return keys.flatMap((key) => {
    const item = ITEM_BY_KEY.get(key);
    return item ? [item] : [];
  });
}
