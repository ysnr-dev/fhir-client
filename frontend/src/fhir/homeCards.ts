import { HOME_WORKLIST_KEYS, HOME_WORKLISTS, type HomeWorklistKey } from "./homeSections";
import { isDoctorRoleCode, isNursingRoleCode } from "./practitionerRoleHelpers";

// ホーム(トップページ)に並べるカードの登録表。カードの種類(kind)とカードごとの設定の形、
// 職種から決める既定の並び、保存した設定(backend の home_layouts)の読み込みを持つ。
// hook を持たない純関数だけにして、画面(pages/HomePage.tsx)は cards の順に部品を並べるだけにする。
// 種類を足すときはここに 1 要素足し、型エラーになった対応表(components/homeCards/index.tsx)を埋める。

export type HomeCardKind =
  | "bulletin"
  | "notifications"
  | "outpatient"
  | "inpatient"
  | "worklist"
  | "consult"
  | "team"
  | "nursing"
  | "chemoRoom"
  | "emergency"
  | "wardStatus"
  | "countersigns"
  | "documentsDue"
  | "resultFollowup"
  | "infectiousReports"
  | "nursingSummaryApprovals"
  | "dashboard"
  | "folder"
  | "shortcuts";

/** カードごとの設定。設定の無い種類は空のオブジェクト。 */
export interface HomeCardSettingsMap {
  bulletin: Record<never, never>;
  notifications: Record<never, never>;
  /** 自分が担当医の予約だけか、全体か。 */
  outpatient: { scope: "mine" | "all" };
  /** 主治医として担当する入院患者か、担当看護師(業務分担を含む)としてか。 */
  inpatient: { by: "attending" | "nurse" };
  worklist: { worklist: HomeWorklistKey };
  /** 依頼先の診療科。 */
  consult: { departmentId: string };
  team: { teamId: string };
  nursing: { wardId: string };
  chemoRoom: Record<never, never>;
  emergency: Record<never, never>;
  /** 空は全病棟。 */
  wardStatus: { wardId: string };
  countersigns: Record<never, never>;
  documentsDue: Record<never, never>;
  resultFollowup: Record<never, never>;
  infectiousReports: Record<never, never>;
  nursingSummaryApprovals: { wardId: string };
  dashboard: { code: string };
  folder: { folderId: number };
  /** 画面のパス(appMenu.ts の候補から選ぶ)。 */
  shortcuts: { links: string[] };
}

export interface HomeCardOf<K extends HomeCardKind> {
  id: string;
  kind: K;
  settings: HomeCardSettingsMap[K];
}

export type HomeCard = { [K in HomeCardKind]: HomeCardOf<K> }[HomeCardKind];

export type HomeCardGroup = "基本" | "診療" | "看護" | "部門" | "病床" | "データ";

/**
 * 編集画面の設定欄。ward / department / team / dashboard / folder は一覧から選ぶ参照、
 * links は画面のパスの複数選択、enum は固定の選択肢。
 */
export type HomeCardField =
  | {
      key: string;
      label: string;
      type: "ward" | "department" | "team" | "dashboard" | "folder" | "links";
      /** 空を許すときの表示(病棟の「全病棟」など)。無ければ必須。 */
      blankLabel?: string;
    }
  | { key: string; label: string; type: "enum"; options: { code: string; label: string }[] };

export interface HomeCardDef<K extends HomeCardKind> {
  label: string;
  group: HomeCardGroup;
  defaultSettings: HomeCardSettingsMap[K];
  /** 同じ種類を複数置けるか(設定で区別できるもの)。 */
  multiple: boolean;
  fields: HomeCardField[];
  /** 「追加」の候補に設定済みで並べる(部門ワークリストを部門ごとに出す)。 */
  variants?: { label: string; settings: HomeCardSettingsMap[K] }[];
  /** 横 2 列を使う。 */
  wide?: boolean;
}

const NONE: Record<never, never> = {};

export const HOME_CARD_KINDS: { [K in HomeCardKind]: HomeCardDef<K> } = {
  bulletin: { label: "掲示板", group: "基本", defaultSettings: NONE, multiple: false, fields: [] },
  notifications: { label: "未対応の通知", group: "基本", defaultSettings: NONE, multiple: false, fields: [] },
  shortcuts: {
    label: "ショートカット",
    group: "基本",
    defaultSettings: { links: [] },
    multiple: false,
    fields: [{ key: "links", label: "画面", type: "links" }],
  },
  outpatient: {
    label: "本日の外来",
    group: "診療",
    defaultSettings: { scope: "all" },
    multiple: false,
    fields: [
      {
        key: "scope",
        label: "範囲",
        type: "enum",
        options: [
          { code: "mine", label: "自分の予約" },
          { code: "all", label: "全体" },
        ],
      },
    ],
  },
  inpatient: {
    label: "担当入院患者",
    group: "診療",
    defaultSettings: { by: "attending" },
    multiple: false,
    fields: [
      {
        key: "by",
        label: "担当",
        type: "enum",
        options: [
          { code: "attending", label: "主治医" },
          { code: "nurse", label: "担当看護師" },
        ],
      },
    ],
  },
  consult: {
    label: "他科依頼",
    group: "診療",
    defaultSettings: { departmentId: "" },
    multiple: true,
    fields: [{ key: "departmentId", label: "依頼先", type: "department" }],
  },
  countersigns: { label: "カウンターサイン待ち", group: "診療", defaultSettings: NONE, multiple: false, fields: [] },
  documentsDue: { label: "期限のある書類", group: "診療", defaultSettings: NONE, multiple: false, fields: [] },
  resultFollowup: { label: "検査結果フォロー", group: "診療", defaultSettings: NONE, multiple: false, fields: [] },
  infectiousReports: { label: "感染症発生届", group: "診療", defaultSettings: NONE, multiple: false, fields: [] },
  nursing: {
    label: "看護指示",
    group: "看護",
    defaultSettings: { wardId: "" },
    multiple: true,
    fields: [{ key: "wardId", label: "病棟", type: "ward" }],
  },
  nursingSummaryApprovals: {
    label: "看護サマリー承認待ち",
    group: "看護",
    defaultSettings: { wardId: "" },
    multiple: true,
    fields: [{ key: "wardId", label: "病棟", type: "ward" }],
  },
  worklist: {
    label: "部門ワークリスト",
    group: "部門",
    defaultSettings: { worklist: "lab" },
    multiple: true,
    fields: [],
    variants: HOME_WORKLIST_KEYS.map((key) => ({ label: HOME_WORKLISTS[key].label, settings: { worklist: key } })),
  },
  chemoRoom: { label: "化学療法室", group: "部門", defaultSettings: NONE, multiple: false, fields: [] },
  team: {
    label: "チーム依頼",
    group: "部門",
    defaultSettings: { teamId: "" },
    multiple: true,
    fields: [{ key: "teamId", label: "チーム", type: "team" }],
  },
  emergency: { label: "救急", group: "病床", defaultSettings: NONE, multiple: false, fields: [] },
  wardStatus: {
    label: "病棟の状況",
    group: "病床",
    defaultSettings: { wardId: "" },
    multiple: true,
    fields: [{ key: "wardId", label: "病棟", type: "ward", blankLabel: "全病棟" }],
  },
  dashboard: {
    label: "分析ダッシュボード",
    group: "データ",
    defaultSettings: { code: "" },
    multiple: true,
    fields: [{ key: "code", label: "分析ダッシュボード", type: "dashboard" }],
    wide: true,
  },
  folder: {
    label: "患者フォルダ",
    group: "データ",
    defaultSettings: { folderId: 0 },
    multiple: true,
    fields: [{ key: "folderId", label: "フォルダ", type: "folder" }],
  },
};

export const HOME_CARD_KIND_KEYS = Object.keys(HOME_CARD_KINDS) as HomeCardKind[];
export const HOME_CARD_GROUPS: HomeCardGroup[] = ["基本", "診療", "看護", "部門", "病床", "データ"];

/** backend(home_layouts.definition)に保存する形。 */
export interface HomeLayoutBody {
  schema_version: 1;
  cards: { id: string; kind: string; settings?: Record<string, unknown> }[];
}

export const HOME_MAX_CARDS = 30;

/** 自動更新の対象になる種類(外来一覧・救急一覧と同じ 1 分ごとの読み直し)。 */
export const HOME_POLLING_KINDS: readonly HomeCardKind[] = ["outpatient", "emergency"];

export function newHomeCardId(): string {
  return crypto.randomUUID();
}

function card<K extends HomeCardKind>(kind: K, settings: HomeCardSettingsMap[K], id: string = kind): HomeCardOf<K> {
  return { id, kind, settings };
}

/**
 * 保存した設定が無い人の既定。職種(所属ロールの code)で決める。
 *
 *   administrator(医療従事者に紐付かない) … 掲示板だけ
 *   医師・歯科医師                        … 掲示板 / 通知 / 自分の外来予約 / 主治医の入院患者 / 検査結果フォロー
 *   看護師・保健師・助産師                … 掲示板 / 通知 / 担当看護師の入院患者
 *   部門の職種(HOME_WORKLISTS に載る)     … 掲示板 / 通知 / 自部門のワークリスト件数
 *   事務職員・それ以外・職種未登録        … 掲示板 / 通知 / 本日の外来(全体)
 *
 * 所属科は絞り込みに使わない(医師の外来・入院は医師 id で絞る。科で絞ると他科で
 * 診た予約が落ちる)。
 */
export function defaultHomeCards(input: {
  administrator: boolean;
  practitionerId: string | null;
  roleCode: string | undefined;
}): HomeCard[] {
  if (input.administrator || !input.practitionerId) return [card("bulletin", NONE)];
  const code = input.roleCode;
  const head: HomeCard[] = [card("bulletin", NONE), card("notifications", NONE)];
  if (isDoctorRoleCode(code)) {
    return [
      ...head,
      card("outpatient", { scope: "mine" }),
      card("inpatient", { by: "attending" }),
      card("resultFollowup", NONE),
      card("infectiousReports", NONE),
    ];
  }
  if (isNursingRoleCode(code)) return [...head, card("inpatient", { by: "nurse" })];
  const worklists = code
    ? HOME_WORKLIST_KEYS.filter((key) => HOME_WORKLISTS[key].roleCodes.includes(code))
    : [];
  if (worklists.length > 0) {
    return [...head, ...worklists.map((key) => card("worklist", { worklist: key }, `worklist-${key}`))];
  }
  return [...head, card("outpatient", { scope: "all" })];
}

function isHomeCardKind(kind: string): kind is HomeCardKind {
  return kind in HOME_CARD_KINDS;
}

/**
 * 保存した設定の値を 1 つ検める。型や選択肢が合わないものは既定に戻す(編集画面で直せる)。
 * 設定欄に載らないキー(worklist の部門)は型だけ見る。
 */
function normalizeSettings(kind: HomeCardKind, stored: unknown): Record<string, unknown> {
  const def = HOME_CARD_KINDS[kind];
  const defaults = def.defaultSettings as Record<string, unknown>;
  const raw = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...defaults };
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = raw[key];
    const field = def.fields.find((f) => f.key === key);
    if (field?.type === "enum") {
      if (typeof value === "string" && field.options.some((o) => o.code === value)) out[key] = value;
    } else if (field?.type === "links") {
      if (Array.isArray(value)) out[key] = value.filter((v): v is string => typeof v === "string");
    } else if (typeof value === typeof fallback) {
      out[key] = value;
    }
  }
  if (kind === "worklist" && !(out.worklist as string in HOME_WORKLISTS)) out.worklist = defaults.worklist;
  return out;
}

/**
 * 保存した設定をカードの並びに。知らない種類と重複した id は落とす。保存していない(null)なら
 * null を返し、呼び出し側が既定(defaultHomeCards)を使う。
 */
export function normalizeHomeCards(body: HomeLayoutBody | null | undefined): HomeCard[] | null {
  if (!body || !Array.isArray(body.cards)) return null;
  const seen = new Set<string>();
  const cards: HomeCard[] = [];
  for (const entry of body.cards) {
    if (!entry || typeof entry.id !== "string" || typeof entry.kind !== "string") continue;
    if (!isHomeCardKind(entry.kind) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    cards.push({ id: entry.id, kind: entry.kind, settings: normalizeSettings(entry.kind, entry.settings) } as HomeCard);
  }
  return cards.slice(0, HOME_MAX_CARDS);
}

export function toHomeLayoutBody(cards: HomeCard[]): HomeLayoutBody {
  return {
    schema_version: 1,
    cards: cards.map((c) => ({ id: c.id, kind: c.kind, settings: c.settings as Record<string, unknown> })),
  };
}

/** 参照の設定(病棟・科・チーム・ダッシュボード・フォルダ)の表示名を引く。 */
export type HomeCardNameResolver = (field: HomeCardField, value: string) => string | undefined;

/** 編集画面の行名。「検体検査」「担当入院患者(担当看護師)」「看護指示(東3階病棟)」など。 */
export function homeCardLabel(card: HomeCard, resolve?: HomeCardNameResolver): string {
  const def = HOME_CARD_KINDS[card.kind];
  if (card.kind === "worklist") return HOME_WORKLISTS[card.settings.worklist].label;
  const settings = card.settings as Record<string, unknown>;
  const parts = def.fields.flatMap((field) => {
    const value = settings[field.key];
    if (field.type === "enum") return field.options.find((o) => o.code === value)?.label ?? [];
    if (field.type === "links") return [];
    const text = value === "" || value === 0 || value === undefined ? "" : String(value);
    if (!text) return field.blankLabel ?? [];
    return resolve?.(field, text) ?? text;
  });
  return parts.length > 0 ? `${def.label}(${parts.join("・")})` : def.label;
}

/** 設定が足りていて保存できるか(必須の参照が空のカードは保存させない)。 */
export function isHomeCardComplete(card: HomeCard): boolean {
  const settings = card.settings as Record<string, unknown>;
  return HOME_CARD_KINDS[card.kind].fields.every((field) => {
    if (field.type === "enum" || field.type === "links" || field.blankLabel !== undefined) return true;
    const value = settings[field.key];
    return value !== "" && value !== 0 && value !== undefined;
  });
}
