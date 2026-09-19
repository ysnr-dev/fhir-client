import type {
  PathwayCodeSystem,
  PathwayDetail,
  PathwayEventPayload,
  PathwayOutcomeCategory,
  PathwayPayload,
  PathwaySetting,
  PathwayStatus,
  PathwayTaskCategoryLv1,
} from "../api/masterClient";
import type { CodeOption } from "./injectionHelpers";
import { isOrderSetOrderType } from "./orderSetHelpers";

// クリニカルパス(施設パス)定義マスタの選択肢と、画面の入力値(draft)と API の相互変換。
// React に依存しない。設計は docs/clinical-pathway-design.md。分類のコードは ePath R4
// 実装ガイド(https://e-path.jp/fhir/ePath/)の CodeSystem に合わせる。

export const PATHWAY_STATUS_OPTIONS: { code: PathwayStatus; display: string }[] = [
  { code: "draft", display: "下書き" },
  { code: "approved", display: "承認済" },
  { code: "retired", display: "廃止" },
];

export const PATHWAY_SETTING_OPTIONS: { code: PathwaySetting; display: string }[] = [
  { code: "inpatient", display: "入院" },
  { code: "outpatient", display: "外来" },
];

export const OUTCOME_CATEGORY_OPTIONS: { code: PathwayOutcomeCategory; display: string }[] = [
  { code: "G", display: "患者目標" },
  { code: "H", display: "患者状態" },
];

export const CODE_SYSTEM_OPTIONS: { code: PathwayCodeSystem; display: string }[] = [
  { code: "bom", display: "BOM" },
  { code: "local", display: "ローカル" },
];

/** BOM の観察項目分類のうち実装ガイドに載っているもの。入力欄の候補に出す。 */
export const ASSESSMENT_CATEGORY_SUGGESTIONS: { code: string; display: string }[] = [
  { code: "19", display: "バイタルサイン" },
  { code: "34", display: "呼吸" },
  { code: "37", display: "出血" },
];

export const TASK_CATEGORY_LV1_OPTIONS: { code: PathwayTaskCategoryLv1; display: string }[] = [
  { code: "TP", display: "治療" },
  { code: "EX", display: "検査" },
  { code: "ML", display: "食事" },
  { code: "NO", display: "観察項目" },
  { code: "NC", display: "ケア項目" },
  { code: "EG", display: "教育・指導・説明" },
  { code: "AL", display: "活動・安静度" },
  { code: "MD", display: "医療文書" },
];

const NURSING_CARE_LV2 = [
  "清潔ケア",
  "排泄ケア",
  "食事介助",
  "移動・移送",
  "体位・安楽",
  "創処置",
  "ドレーン管理",
  "カテーテル管理",
  "点滴管理",
  "酸素管理",
  "呼吸ケア",
  "疼痛ケア",
  "皮膚ケア",
  "精神的支援",
  "転倒・転落予防",
  "感染予防",
  "行動制限時のケア",
];

export const TASK_CATEGORY_LV2_OPTIONS: { code: string; display: string; lv1: PathwayTaskCategoryLv1 }[] = [
  { code: "TPPR", display: "処方", lv1: "TP" },
  { code: "TPIN", display: "注射", lv1: "TP" },
  { code: "TPRE", display: "レジメン", lv1: "TP" },
  { code: "TPTR", display: "処置", lv1: "TP" },
  { code: "TPOP", display: "手術", lv1: "TP" },
  { code: "TPBT", display: "輸血", lv1: "TP" },
  { code: "TPRH", display: "リハビリ", lv1: "TP" },
  { code: "TPDI", display: "透析", lv1: "TP" },
  { code: "TPRT", display: "放射線治療", lv1: "TP" },
  { code: "TPCI", display: "条件付き指示", lv1: "TP" },
  { code: "EXSP", display: "検体検査", lv1: "EX" },
  { code: "EXMB", display: "細菌検査", lv1: "EX" },
  { code: "EXPH", display: "生理検査", lv1: "EX" },
  { code: "EXEN", display: "内視鏡検査", lv1: "EX" },
  { code: "EXIM", display: "画像診断", lv1: "EX" },
  { code: "EXPA", display: "病理診断", lv1: "EX" },
  { code: "MLBR", display: "朝", lv1: "ML" },
  { code: "MLLU", display: "昼", lv1: "ML" },
  { code: "MLSU", display: "夕", lv1: "ML" },
  ...NURSING_CARE_LV2.map((display, i) => ({
    code: `NC${String(i + 1).padStart(2, "0")}`,
    display,
    lv1: "NC" as const,
  })),
  { code: "EGNC", display: "栄養指導", lv1: "EG" },
  { code: "EGCS", display: "指導", lv1: "EG" },
  { code: "EGIC", display: "IC", lv1: "EG" },
  { code: "EGEP", display: "看護Eプラン", lv1: "EG" },
];

export function taskCategoryLv2Options(lv1: PathwayTaskCategoryLv1): { code: string; display: string }[] {
  return TASK_CATEGORY_LV2_OPTIONS.filter((o) => o.lv1 === lv1);
}

/** タスク分類(中)から、オーダー雛形の既定の種別。 */
export const DEFAULT_ORDER_TYPE_BY_LV2: Record<string, string> = {
  TPPR: "prescription",
  TPIN: "injection",
  TPTR: "treatment-order",
  TPOP: "surgery-order",
  TPBT: "transfusion-order",
  TPRH: "rehab-order",
  EXSP: "lab-order",
  EXMB: "micro-order",
  EXPH: "physio-order",
  EXEN: "endoscopy-order",
  EXIM: "rad-order",
  EXPA: "patho-order",
  MLBR: "meal-order",
  MLLU: "meal-order",
  MLSU: "meal-order",
  EGNC: "nutrition-guidance-order",
};

/** タスク分類(大)だけのタスクの既定の種別。ケア項目は看護指示、食事は食事オーダー。 */
const DEFAULT_ORDER_TYPE_BY_LV1: Record<string, string> = {
  NC: "nursing-order",
  ML: "meal-order",
};

/** タスクの分類から、オーダー雛形の既定の種別。対応する種別が無ければ処方。 */
export function defaultOrderTypeOfTask(lv1: string, lv2: string | null | undefined): string {
  if (lv2 && lv2.startsWith("NC")) return "nursing-order";
  return (
    (lv2 ? DEFAULT_ORDER_TYPE_BY_LV2[lv2] : undefined) ??
    DEFAULT_ORDER_TYPE_BY_LV1[lv1] ??
    "prescription"
  );
}

export function displayOfOption(options: readonly CodeOption[], code: string | null | undefined): string {
  if (!code) return "";
  return options.find((o) => o.code === code)?.display ?? code;
}

export function taskCategoryLabel(lv1: string, lv2: string | null | undefined): string {
  const l1 = displayOfOption(TASK_CATEGORY_LV1_OPTIONS, lv1);
  const l2 = lv2 ? displayOfOption(TASK_CATEGORY_LV2_OPTIONS, lv2) : "";
  return l2 ? `${l1} / ${l2}` : l1;
}

/** 病日の既定の見出し。入院日 = 1、入院前日 = -1。 */
export function defaultDayLabel(elapsedDays: number): string {
  if (elapsedDays === 1) return "入院日";
  if (elapsedDays === -1) return "入院前日";
  if (elapsedDays < 0) return `入院${-elapsedDays}日前`;
  return `${elapsedDays}日目`;
}

export function eventDayLabel(elapsedDays: number, title: string): string {
  return title.trim() || defaultDayLabel(elapsedDays);
}

/**
 * 同じ病日をパスステップで分けたときの、ステップの見出し(術前 / 術後 など)。
 * 名前が無ければ「ステップ n」。
 */
export function pathStepLabel(pathStep: number, pathStepName: string | null | undefined): string {
  return pathStepName?.trim() || `ステップ${pathStep}`;
}

/**
 * 病日の見出しにステップを添えた表示(「手術当日 術後」)。分けていない病日(ステップ 1 だけで
 * 名前も無い)は病日の見出しだけ。
 */
export function eventDayStepLabel(
  elapsedDays: number,
  title: string | null | undefined,
  pathStep: number,
  pathStepName: string | null | undefined,
): string {
  const day = eventDayLabel(elapsedDays, title ?? "");
  if (pathStep <= 1 && !pathStepName?.trim()) return day;
  return `${day} ${pathStepLabel(pathStep, pathStepName)}`;
}

/** ePath の action.id(病日[-パスステップ])。 */
export function eventIdOf(elapsedDays: number, pathStep: number): string {
  return pathStep <= 1 ? String(elapsedDays) : `${elapsedDays}-${pathStep}`;
}

// ---- draft ----

export interface PathwayTaskTemplate {
  orderType: string;
  label: string;
  values: unknown;
  schemaVersion: number;
  /** このクライアントで編集できない種別・版(要約だけ出し、保存時はそのまま戻す)。 */
  unsupported: boolean;
}

export interface PathwayTaskDraft {
  key: number;
  taskKey: string;
  /** 結ぶ観察項目の識別子。空なら結ばない。 */
  assessmentKey: string;
  name: string;
  categoryLv1: PathwayTaskCategoryLv1;
  categoryLv2: string;
  code: string;
  note: string;
  template: PathwayTaskTemplate | null;
}

export interface PathwayAssessmentDraft {
  key: number;
  assessmentKey: string;
  name: string;
  categoryCode: string;
  categoryName: string;
  codeSystem: PathwayCodeSystem | "";
  code: string;
  properValue: string;
  nursingObservationManageNo: string;
  note: string;
}

export interface PathwayOatUnitDraft {
  key: number;
  unitKey: string;
  name: string;
  category: PathwayOutcomeCategory | "";
  codeSystem: PathwayCodeSystem | "";
  code: string;
  critical: boolean;
  note: string;
  assessments: PathwayAssessmentDraft[];
  tasks: PathwayTaskDraft[];
}

export interface PathwayPhaseBranchDraft {
  key: number;
  /** 次のフェーズ。空は「ここでパスを終了」。 */
  toPhaseKey: string;
  criteria: string;
}

/** フェーズ(連続する病日のまとまり)。適用はフェーズ単位で進め、終わりで分岐から次を選ぶ。 */
export interface PathwayPhaseDraft {
  key: number;
  phaseKey: string;
  name: string;
  note: string;
  /** 次の候補。先頭が標準の経路。 */
  branches: PathwayPhaseBranchDraft[];
}

export interface PathwayEventDraft {
  key: number;
  phaseKey: string;
  elapsedDays: string;
  /** パスステップ(同じ病日を術前・術後などに分けたときの順番。分けなければ 1)。 */
  pathStep: number;
  pathStepName: string;
  title: string;
  note: string;
  oatUnits: PathwayOatUnitDraft[];
}

export interface PathwayIndicationDraft {
  key: number;
  managementNumber: string;
  name: string;
  icd10: string;
}

export interface PathwayDraft {
  pathwayCode: string;
  name: string;
  shortName: string;
  nameKana: string;
  version: string;
  departmentCode: string;
  departmentName: string;
  setting: PathwaySetting;
  scheduledDays: string;
  adaptiveCriteria: string;
  protocolBase: string;
  status: PathwayStatus;
  approvedOn: string;
  approvedBy: string;
  copiedFromCode: string;
  validFrom: string;
  validTo: string;
  displayOrder: string;
  note: string;
  indications: PathwayIndicationDraft[];
  /** 先頭が開始フェーズ。必ず 1 つ以上ある。 */
  phases: PathwayPhaseDraft[];
  events: PathwayEventDraft[];
}

let nextKey = 1;
/** 行の React key。保存済みの id とは無関係で、画面を開いている間だけ一意。 */
export function newDraftKey(): number {
  return nextKey++;
}

/** OAT ユニット・観察項目・タスクの識別子。適用後データまで持ち越すので画面で採る。 */
export function newPathwayUuid(): string {
  return crypto.randomUUID();
}

export function emptyPhaseDraft(): PathwayPhaseDraft {
  return { key: newDraftKey(), phaseKey: newPathwayUuid(), name: "", note: "", branches: [] };
}

export function emptyPathwayDraft(): PathwayDraft {
  return {
    pathwayCode: "",
    name: "",
    shortName: "",
    nameKana: "",
    version: "",
    departmentCode: "",
    departmentName: "",
    setting: "inpatient",
    scheduledDays: "",
    adaptiveCriteria: "",
    protocolBase: "",
    status: "draft",
    approvedOn: "",
    approvedBy: "",
    copiedFromCode: "",
    validFrom: "",
    validTo: "",
    displayOrder: "",
    note: "",
    indications: [],
    phases: [emptyPhaseDraft()],
    events: [],
  };
}

export function emptyEventDraft(elapsedDays: number, phaseKey = ""): PathwayEventDraft {
  return {
    key: newDraftKey(),
    phaseKey,
    elapsedDays: String(elapsedDays),
    pathStep: 1,
    pathStepName: "",
    title: "",
    note: "",
    oatUnits: [],
  };
}

export function emptyOatUnitDraft(): PathwayOatUnitDraft {
  return {
    key: newDraftKey(),
    unitKey: newPathwayUuid(),
    name: "",
    category: "",
    codeSystem: "",
    code: "",
    critical: false,
    note: "",
    assessments: [],
    tasks: [],
  };
}

export function emptyAssessmentDraft(): PathwayAssessmentDraft {
  return {
    key: newDraftKey(),
    assessmentKey: newPathwayUuid(),
    name: "",
    categoryCode: "",
    categoryName: "",
    codeSystem: "",
    code: "",
    properValue: "",
    nursingObservationManageNo: "",
    note: "",
  };
}

export function emptyTaskDraft(categoryLv1: PathwayTaskCategoryLv1 = "NC"): PathwayTaskDraft {
  return {
    key: newDraftKey(),
    taskKey: newPathwayUuid(),
    assessmentKey: "",
    name: "",
    categoryLv1,
    categoryLv2: "",
    code: "",
    note: "",
    template: null,
  };
}

function str(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function draftFromPathway(detail: PathwayDetail): PathwayDraft {
  const phases: PathwayPhaseDraft[] = detail.phases.map((p) => ({
    key: newDraftKey(),
    phaseKey: p.phase_key,
    name: str(p.name),
    note: str(p.note),
    branches: p.branches.map((b) => ({ key: newDraftKey(), toPhaseKey: str(b.to_phase_key), criteria: str(b.criteria) })),
  }));
  if (phases.length === 0) phases.push(emptyPhaseDraft());
  const phaseKeys = new Set(phases.map((p) => p.phaseKey));
  return {
    pathwayCode: detail.pathway_code,
    name: detail.name,
    shortName: str(detail.short_name),
    nameKana: str(detail.name_kana),
    version: str(detail.version),
    departmentCode: str(detail.department_code),
    departmentName: str(detail.department_name),
    setting: detail.setting,
    scheduledDays: str(detail.scheduled_days),
    adaptiveCriteria: str(detail.adaptive_criteria),
    protocolBase: str(detail.protocol_base),
    status: detail.status,
    approvedOn: str(detail.approved_on),
    approvedBy: str(detail.approved_by),
    copiedFromCode: str(detail.copied_from_code),
    validFrom: str(detail.valid_from),
    validTo: str(detail.valid_to),
    displayOrder: str(detail.display_order),
    note: str(detail.note),
    indications: detail.indications.map((i) => ({
      key: newDraftKey(),
      managementNumber: i.management_number,
      name: i.name,
      icd10: str(i.icd10),
    })),
    phases,
    events: detail.events.map((e) => ({
      key: newDraftKey(),
      phaseKey: phaseKeys.has(e.phase_key) ? e.phase_key : phases[0].phaseKey,
      elapsedDays: String(e.elapsed_days),
      pathStep: e.path_step,
      pathStepName: str(e.path_step_name),
      title: str(e.title),
      note: str(e.note),
      oatUnits: e.oat_units.map((u) => ({
        key: newDraftKey(),
        unitKey: u.unit_key,
        name: u.name,
        category: u.category ?? "",
        codeSystem: u.code_system ?? "",
        code: str(u.code),
        critical: u.critical,
        note: str(u.note),
        assessments: u.assessments.map((a) => ({
          key: newDraftKey(),
          assessmentKey: a.assessment_key,
          name: a.name,
          categoryCode: str(a.category_code),
          categoryName: str(a.category_name),
          codeSystem: a.code_system ?? "",
          code: str(a.code),
          properValue: str(a.proper_value),
          nursingObservationManageNo: str(a.nursing_observation_manage_no),
          note: str(a.note),
        })),
        tasks: u.tasks.map((t) => ({
          key: newDraftKey(),
          taskKey: t.task_key,
          assessmentKey: str(t.assessment_key),
          name: t.name,
          categoryLv1: t.category_lv1,
          categoryLv2: str(t.category_lv2),
          code: str(t.code),
          note: str(t.note),
          template: t.order_type
            ? {
                orderType: t.order_type,
                label: str(t.order_label),
                values: t.order_values ?? {},
                schemaVersion: t.order_schema_version ?? 1,
                unsupported: !isOrderSetOrderType(t.order_type),
              }
            : null,
        })),
      })),
    })),
  };
}

function numOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function textOrNull(text: string): string | null {
  return text.trim() === "" ? null : text;
}

/**
 * 承認済・廃止のパスで送る値。内容は凍結されているので運用の項目だけにする
 * (子を送ると backend が「内容の変更」とみなして弾く)。
 */
export function operationalPayloadFromDraft(draft: PathwayDraft): PathwayPayload {
  return {
    status: draft.status,
    valid_from: textOrNull(draft.validFrom),
    valid_to: textOrNull(draft.validTo),
    display_order: numOrNull(draft.displayOrder),
  };
}

function eventPayload(event: PathwayEventDraft): PathwayEventPayload {
  return {
    phase_key: event.phaseKey,
    elapsed_days: numOrNull(event.elapsedDays) ?? 0,
    path_step: event.pathStep,
    path_step_name: textOrNull(event.pathStepName),
    title: textOrNull(event.title),
    note: textOrNull(event.note),
    oat_units: event.oatUnits.map((u) => ({
      unit_key: u.unitKey,
      name: u.name.trim(),
      category: u.category || null,
      code_system: u.codeSystem || null,
      code: textOrNull(u.code),
      critical: u.critical,
      note: textOrNull(u.note),
      assessments: u.assessments.map((a) => ({
        assessment_key: a.assessmentKey,
        name: a.name.trim(),
        category_code: textOrNull(a.categoryCode),
        category_name: textOrNull(a.categoryName),
        code_system: a.codeSystem || null,
        code: textOrNull(a.code),
        proper_value: textOrNull(a.properValue),
        nursing_observation_manage_no: textOrNull(a.nursingObservationManageNo),
        note: textOrNull(a.note),
      })),
      tasks: u.tasks.map((t) => ({
        task_key: t.taskKey,
        assessment_key: t.assessmentKey || null,
        name: t.name.trim(),
        category_lv1: t.categoryLv1,
        category_lv2: textOrNull(t.categoryLv2),
        code: textOrNull(t.code),
        order_type: t.template?.orderType ?? null,
        order_label: t.template ? textOrNull(t.template.label) : null,
        order_values: t.template?.values ?? {},
        order_schema_version: t.template?.schemaVersion ?? null,
        note: textOrNull(t.note),
      })),
    })),
  };
}

export function payloadFromDraft(draft: PathwayDraft): PathwayPayload {
  return {
    pathway_code: draft.pathwayCode.trim() || undefined,
    name: draft.name.trim(),
    short_name: textOrNull(draft.shortName),
    name_kana: textOrNull(draft.nameKana),
    version: textOrNull(draft.version),
    department_code: textOrNull(draft.departmentCode),
    department_name: textOrNull(draft.departmentName),
    setting: draft.setting,
    scheduled_days: numOrNull(draft.scheduledDays),
    adaptive_criteria: textOrNull(draft.adaptiveCriteria),
    protocol_base: textOrNull(draft.protocolBase),
    status: draft.status,
    valid_from: textOrNull(draft.validFrom),
    valid_to: textOrNull(draft.validTo),
    display_order: numOrNull(draft.displayOrder),
    note: textOrNull(draft.note),
    indications: draft.indications.map((i) => ({
      management_number: i.managementNumber,
      name: i.name,
      icd10: textOrNull(i.icd10),
    })),
    phases: draft.phases.map((p) => ({
      phase_key: p.phaseKey,
      name: textOrNull(p.name.trim()),
      note: textOrNull(p.note),
      branches: p.branches.map((b) => ({ to_phase_key: b.toPhaseKey || null, criteria: textOrNull(b.criteria) })),
    })),
    events: sortEventsByDay(draft.events).map(eventPayload),
  };
}

// ---- 病日の操作 ----

export function eventDayOf(event: Pick<PathwayEventDraft, "elapsedDays">): number | null {
  const n = numOrNull(event.elapsedDays);
  return n !== null && Number.isInteger(n) ? n : null;
}

/**
 * フェーズごとに病日順で並べる(書式が不正な行はフェーズの末尾)。フェーズの順は配列に現れた順を保つ
 * (フェーズを並べ替えるときは orderEventsByPhases で病日の並びも揃える)。
 */
export function sortEventsByDay(events: PathwayEventDraft[]): PathwayEventDraft[] {
  const phaseOrder = new Map<string, number>();
  for (const e of events) if (!phaseOrder.has(e.phaseKey)) phaseOrder.set(e.phaseKey, phaseOrder.size);
  return events
    .map((e, index) => ({ e, index, day: eventDayOf(e), phase: phaseOrder.get(e.phaseKey) ?? 0 }))
    .sort((a, b) => {
      if (a.phase !== b.phase) return a.phase - b.phase;
      if (a.day === null && b.day === null) return a.index - b.index;
      if (a.day === null) return 1;
      if (b.day === null) return -1;
      return a.day - b.day || a.e.pathStep - b.e.pathStep || a.index - b.index;
    })
    .map((x) => x.e);
}

/** 病日をフェーズの並びに揃える(フェーズの追加・並べ替え・削除のあと)。 */
export function orderEventsByPhases(events: PathwayEventDraft[], phases: PathwayPhaseDraft[]): PathwayEventDraft[] {
  const order = new Map(phases.map((p, index) => [p.phaseKey, index]));
  const kept = events.filter((e) => order.has(e.phaseKey));
  return sortEventsByDay(
    kept
      .map((e, index) => ({ e, index }))
      .sort((a, b) => (order.get(a.e.phaseKey) ?? 0) - (order.get(b.e.phaseKey) ?? 0) || a.index - b.index)
      .map((x) => x.e),
  );
}

export function eventsOfPhase(events: PathwayEventDraft[], phaseKey: string): PathwayEventDraft[] {
  return events.filter((e) => e.phaseKey === phaseKey);
}

/**
 * フェーズを足す。最初の病日は直前のフェーズの続き(最終病日の次)から始める。
 * 分岐先どうしは同じ病日から始めるので、足したあとで病日を直せる。
 */
export function addPhaseDraft(draft: PathwayDraft): PathwayDraft {
  const phase = emptyPhaseDraft();
  const previous = draft.phases[draft.phases.length - 1];
  const day = nextDayNumber(previous ? eventsOfPhase(draft.events, previous.phaseKey) : []);
  return {
    ...draft,
    phases: [...draft.phases, phase],
    events: [...draft.events, emptyEventDraft(day, phase.phaseKey)],
  };
}

/** フェーズを外す。配下の病日と、そのフェーズへ進む分岐も外す。最後の 1 つは外せない。 */
export function removePhaseDraft(draft: PathwayDraft, phaseKey: string): PathwayDraft {
  if (draft.phases.length <= 1) return draft;
  const phases = draft.phases
    .filter((p) => p.phaseKey !== phaseKey)
    .map((p) => ({ ...p, branches: p.branches.filter((b) => b.toPhaseKey !== phaseKey) }));
  return { ...draft, phases, events: orderEventsByPhases(draft.events, phases) };
}

export function movePhaseDraft(draft: PathwayDraft, phaseKey: string, delta: -1 | 1): PathwayDraft {
  const from = draft.phases.findIndex((p) => p.phaseKey === phaseKey);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= draft.phases.length) return draft;
  const phases = [...draft.phases];
  [phases[from], phases[to]] = [phases[to], phases[from]];
  return { ...draft, phases, events: orderEventsByPhases(draft.events, phases) };
}

/** フェーズの見出し(名前が無ければ順番)。 */
export function phaseLabelOf(phases: PathwayPhaseDraft[], phaseKey: string): string {
  const index = phases.findIndex((p) => p.phaseKey === phaseKey);
  return phases[index]?.name.trim() || `フェーズ ${index + 1}`;
}

/** 「＋ 病日」で足す次の病日(最大病日 + 1。無ければ入院日)。 */
export function nextDayNumber(events: PathwayEventDraft[]): number {
  const days = events.map(eventDayOf).filter((d): d is number => d !== null);
  if (days.length === 0) return 1;
  const max = Math.max(...days);
  return max === -1 ? 1 : max + 1;
}

/** 「＋ 入院前日」で足す病日(最小病日 − 1。0 は飛ばす)。 */
export function previousDayNumber(events: PathwayEventDraft[]): number {
  const days = events.map(eventDayOf).filter((d): d is number => d !== null);
  if (days.length === 0) return -1;
  const min = Math.min(...days);
  return min === 1 ? -1 : min - 1;
}

/** OAT ユニットの写し。識別子(unit_key と観察項目・タスクのキー)はそのまま持ち越す = 続き。 */
function continueUnit(unit: PathwayOatUnitDraft): PathwayOatUnitDraft {
  return {
    ...unit,
    key: newDraftKey(),
    assessments: unit.assessments.map((a) => ({ ...a, key: newDraftKey() })),
    tasks: unit.tasks.map((t) => ({ ...t, key: newDraftKey() })),
  };
}

/**
 * 病日を複製する。［決定］識別子は採り直さず写す。同じ識別子を別の病日に置いたものが
 * 「続き」なので、複製した日のアウトカムは元の日と同じ行としてシートに並び、看護指示などの
 * 継続するタスクは 1 件のオーダーにまとまる。別のアウトカムにしたいときは新しく足す。
 */
export function copyEventDraft(event: PathwayEventDraft, elapsedDays: number): PathwayEventDraft {
  return {
    ...event,
    key: newDraftKey(),
    elapsedDays: String(elapsedDays),
    pathStep: 1,
    pathStepName: "",
    title: "",
    oatUnits: event.oatUnits.map(continueUnit),
  };
}

/**
 * 病日を分ける(手術当日の術前・術後など)。同じ病日の最後のステップの次に、空のステップを足す。
 * 見出しは元の日と同じにし、ステップ名で見分ける。
 */
export function splitEventDraft(events: PathwayEventDraft[], event: PathwayEventDraft): PathwayEventDraft {
  const day = eventDayOf(event);
  const lastStep = Math.max(
    ...events.filter((e) => e.phaseKey === event.phaseKey && eventDayOf(e) === day).map((e) => e.pathStep),
    event.pathStep,
  );
  return { ...emptyEventDraft(day ?? 1, event.phaseKey), elapsedDays: event.elapsedDays, pathStep: lastStep + 1, title: event.title };
}

/** 同じ病日にステップが 2 つ以上あるか(ステップ名の欄を出すかどうか)。 */
export function isSplitDay(events: PathwayEventDraft[], event: PathwayEventDraft): boolean {
  const day = eventDayOf(event);
  return (
    day !== null &&
    (event.pathStep > 1 ||
      events.some((e) => e.key !== event.key && e.phaseKey === event.phaseKey && eventDayOf(e) === day))
  );
}

/**
 * 続き(同じ識別子)の同一性に関わる項目を、編集した病日から他の病日へ写す。
 *
 * ［決定］アウトカムの名前・区分・コード・重要、観察項目の名前・分類・コード・看護観察、
 * タスクの名前・分類・コード・オーダー雛形は続き全体で同じにする(同じアウトカム・同じ指示だから)。
 * 観察項目の適正値と備考は病日ごとに持てる(術後の日を追って基準を下げる、など)。
 * 観察項目・タスクを置くかどうかも病日ごとに決められる。
 */
export function propagateSeries(events: PathwayEventDraft[], sourceEventKey: number): PathwayEventDraft[] {
  const source = events.find((e) => e.key === sourceEventKey);
  if (!source) return events;
  const units = new Map(source.oatUnits.map((u) => [u.unitKey, u]));
  const assessments = new Map(source.oatUnits.flatMap((u) => u.assessments.map((a) => [a.assessmentKey, a] as const)));
  const tasks = new Map(source.oatUnits.flatMap((u) => u.tasks.map((t) => [t.taskKey, t] as const)));
  return events.map((event) => {
    if (event.key === sourceEventKey) return event;
    let changed = false;
    const oatUnits = event.oatUnits.map((unit) => {
      const su = units.get(unit.unitKey);
      const next: PathwayOatUnitDraft = {
        ...unit,
        ...(su
          ? { name: su.name, category: su.category, codeSystem: su.codeSystem, code: su.code, critical: su.critical }
          : {}),
        assessments: unit.assessments.map((a) => {
          const sa = assessments.get(a.assessmentKey);
          return sa
            ? {
                ...a,
                name: sa.name,
                categoryCode: sa.categoryCode,
                categoryName: sa.categoryName,
                codeSystem: sa.codeSystem,
                code: sa.code,
                nursingObservationManageNo: sa.nursingObservationManageNo,
              }
            : a;
        }),
        tasks: unit.tasks.map((t) => {
          const st = tasks.get(t.taskKey);
          return st
            ? {
                ...t,
                name: st.name,
                categoryLv1: st.categoryLv1,
                categoryLv2: st.categoryLv2,
                code: st.code,
                template: st.template,
              }
            : t;
        }),
      };
      const same =
        next.name === unit.name &&
        next.category === unit.category &&
        next.codeSystem === unit.codeSystem &&
        next.code === unit.code &&
        next.critical === unit.critical &&
        next.assessments.every((a, i) => shallowEqual(a, unit.assessments[i])) &&
        next.tasks.every((t, i) => shallowEqual(t, unit.tasks[i]));
      if (same) return unit;
      changed = true;
      return next;
    });
    return changed ? { ...event, oatUnits } : event;
  });
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.every((k) => a[k] === b[k]);
}

/** オーダー雛形の要約(一覧・タスク行に出す)。 */
export function templateSummary(template: PathwayTaskTemplate): string {
  return template.label || "(内容なし)";
}

/**
 * 保存前の検証。サーバーの検証と二重になるものは持たず、画面でしか分からないもの
 * (病日の書式・名称の空)だけを見る。問題なければ null。
 */
export function validatePathwayDraft(draft: PathwayDraft): string | null {
  if (!draft.name.trim()) return "パス名を入力してください";
  const scheduled = numOrNull(draft.scheduledDays);
  if (draft.scheduledDays.trim() !== "" && (scheduled === null || !Number.isInteger(scheduled) || scheduled <= 0)) {
    return "パス予定日数は 1 以上の整数で入力してください";
  }
  const seen = new Set<string>();
  for (const event of draft.events) {
    const day = eventDayOf(event);
    if (day === null || day === 0) return "病日は 0 以外の整数で入力してください(入院日 = 1、入院前日 = -1)";
    const id = eventIdOf(day, event.pathStep);
    if (seen.has(`${event.phaseKey}/${id}`)) return `病日 ${id} が重複しています`;
    seen.add(`${event.phaseKey}/${id}`);
    const dayLabel = eventDayLabel(day, event.title);
    for (const [unitIndex, unit] of event.oatUnits.entries()) {
      const unitLabel = `${dayLabel} の OAT ユニット ${unitIndex + 1}`;
      if (!unit.name.trim()) return `${unitLabel} のアウトカム名を入力してください`;
      for (const [index, a] of unit.assessments.entries()) {
        if (!a.name.trim()) return `${unitLabel}(${unit.name})の観察項目 ${index + 1} の名称を入力してください`;
      }
      for (const [index, t] of unit.tasks.entries()) {
        if (!t.name.trim()) return `${unitLabel}(${unit.name})のタスク ${index + 1} の名称を入力してください`;
        if (t.template && !t.template.unsupported && !isOrderSetOrderType(t.template.orderType)) {
          return `${unitLabel}(${unit.name})のタスク「${t.name}」のオーダー雛形の種別が不正です`;
        }
      }
    }
  }
  return null;
}

// ---- 概要表 ----

export interface OverviewColumn {
  /** 画面の病日カードの key(続きを足す・外す先)。 */
  eventKey: number;
  day: number;
  pathStep: number;
  label: string;
  /** 同じ病日を分けたときのステップの見出し。分けていなければ空。 */
  stepLabel: string;
  phaseKey: string;
  /** フェーズの見出し。フェーズが 1 つだけなら空。 */
  phaseLabel: string;
}

export interface OverviewRow {
  /** 続きの識別子(アウトカムは unit_key、タスクは task_key)。 */
  seriesKey: string;
  label: string;
  /** その行が載る病日カードの key。 */
  eventKeys: Set<number>;
  critical: boolean;
}

export interface OverviewTaskRow extends OverviewRow {
  /** タスクが属するアウトカムの unit_key(最初に現れた病日のもの)。その続きが無い日には置けない。 */
  unitKey: string;
}

export interface OverviewRows {
  columns: OverviewColumn[];
  outcomes: OverviewRow[];
  taskGroups: { lv1: PathwayTaskCategoryLv1; label: string; rows: OverviewTaskRow[] }[];
}

/**
 * 概要表の行。［決定］名前ではなく識別子でまとめる(同じ識別子 = 続き)。名前が同じでも
 * 識別子が違えば別の行になり、パスシートの行と一致する。
 */
export function overviewRows(draft: PathwayDraft): OverviewRows {
  const events = sortEventsByDay(draft.events).filter((e) => eventDayOf(e) !== null);
  const columns = events.map((e) => {
    const day = eventDayOf(e) as number;
    return {
      eventKey: e.key,
      day,
      pathStep: e.pathStep,
      label: eventDayLabel(day, e.title),
      stepLabel: isSplitDay(events, e) ? pathStepLabel(e.pathStep, e.pathStepName) : "",
      phaseKey: e.phaseKey,
      phaseLabel: draft.phases.length > 1 ? phaseLabelOf(draft.phases, e.phaseKey) : "",
    };
  });
  const outcomes = new Map<string, OverviewRow>();
  const tasks = new Map<PathwayTaskCategoryLv1, Map<string, OverviewTaskRow>>();
  for (const event of events) {
    for (const unit of event.oatUnits) {
      const row = outcomes.get(unit.unitKey) ?? {
        seriesKey: unit.unitKey,
        label: unit.name.trim() || "(名称未入力)",
        eventKeys: new Set<number>(),
        critical: false,
      };
      row.eventKeys.add(event.key);
      row.critical = row.critical || unit.critical;
      outcomes.set(unit.unitKey, row);
      for (const task of unit.tasks) {
        const group = tasks.get(task.categoryLv1) ?? new Map<string, OverviewTaskRow>();
        const taskRow = group.get(task.taskKey) ?? {
          seriesKey: task.taskKey,
          label: task.name.trim() || "(名称未入力)",
          eventKeys: new Set<number>(),
          critical: false,
          unitKey: unit.unitKey,
        };
        taskRow.eventKeys.add(event.key);
        group.set(task.taskKey, taskRow);
        tasks.set(task.categoryLv1, group);
      }
    }
  }
  return {
    columns,
    outcomes: [...outcomes.values()],
    taskGroups: TASK_CATEGORY_LV1_OPTIONS.filter((o) => tasks.has(o.code)).map((o) => ({
      lv1: o.code,
      label: o.display,
      rows: [...(tasks.get(o.code) as Map<string, OverviewTaskRow>).values()],
    })),
  };
}

/** 続きを写す元。足す先より前の病日で最も近いもの、無ければ後ろで最も近いもの。 */
function nearestOccurrence<T>(
  events: PathwayEventDraft[],
  targetEventKey: number,
  find: (event: PathwayEventDraft) => T | undefined,
): T | undefined {
  const sorted = sortEventsByDay(events);
  const index = sorted.findIndex((e) => e.key === targetEventKey);
  for (let i = index - 1; i >= 0; i--) {
    const found = find(sorted[i]);
    if (found) return found;
  }
  for (let i = index + 1; i < sorted.length; i++) {
    const found = find(sorted[i]);
    if (found) return found;
  }
  return undefined;
}

/** アウトカムの続きをその病日に足す(近い日の内容を識別子ごと写す)。 */
export function addOutcomeOccurrence(
  events: PathwayEventDraft[],
  unitKey: string,
  targetEventKey: number,
): PathwayEventDraft[] {
  const source = nearestOccurrence(events, targetEventKey, (e) => e.oatUnits.find((u) => u.unitKey === unitKey));
  if (!source) return events;
  return events.map((e) =>
    e.key === targetEventKey && !e.oatUnits.some((u) => u.unitKey === unitKey)
      ? { ...e, oatUnits: [...e.oatUnits, continueUnit(source)] }
      : e,
  );
}

/** アウトカムをその病日から外す(他の病日の続きは残る)。 */
export function removeOutcomeOccurrence(
  events: PathwayEventDraft[],
  unitKey: string,
  targetEventKey: number,
): PathwayEventDraft[] {
  return events.map((e) =>
    e.key === targetEventKey ? { ...e, oatUnits: e.oatUnits.filter((u) => u.unitKey !== unitKey) } : e,
  );
}

/**
 * タスクの続きをその病日に足す。タスクは OAT ユニットの中に置くので、そのアウトカムの続きが
 * その日に無ければ足せない(false を返す)。結ぶ観察項目は、足す先の日に同じ観察項目があれば保つ。
 */
export function canAddTaskOccurrence(events: PathwayEventDraft[], row: OverviewTaskRow, targetEventKey: number): boolean {
  const target = events.find((e) => e.key === targetEventKey);
  return Boolean(target?.oatUnits.some((u) => u.unitKey === row.unitKey));
}

export function addTaskOccurrence(
  events: PathwayEventDraft[],
  row: OverviewTaskRow,
  targetEventKey: number,
): PathwayEventDraft[] {
  const source = nearestOccurrence(events, targetEventKey, (e) =>
    e.oatUnits.flatMap((u) => u.tasks).find((t) => t.taskKey === row.seriesKey),
  );
  if (!source) return events;
  return events.map((e) =>
    e.key === targetEventKey
      ? {
          ...e,
          oatUnits: e.oatUnits.map((u) =>
            u.unitKey === row.unitKey && !u.tasks.some((t) => t.taskKey === row.seriesKey)
              ? {
                  ...u,
                  tasks: [
                    ...u.tasks,
                    {
                      ...source,
                      key: newDraftKey(),
                      assessmentKey: u.assessments.some((a) => a.assessmentKey === source.assessmentKey)
                        ? source.assessmentKey
                        : "",
                    },
                  ],
                }
              : u,
          ),
        }
      : e,
  );
}

export function removeTaskOccurrence(
  events: PathwayEventDraft[],
  taskKey: string,
  targetEventKey: number,
): PathwayEventDraft[] {
  return events.map((e) =>
    e.key === targetEventKey
      ? { ...e, oatUnits: e.oatUnits.map((u) => ({ ...u, tasks: u.tasks.filter((t) => t.taskKey !== taskKey) })) }
      : e,
  );
}

/** アウトカムの続きが載る病日の見出し(unit_key → 見出しの並び)。2 日以上のものだけ。 */
export function outcomeSeriesLabels(events: PathwayEventDraft[]): Map<string, string[]> {
  const labels = new Map<string, string[]>();
  for (const event of sortEventsByDay(events)) {
    const day = eventDayOf(event);
    if (day === null) continue;
    const label = isSplitDay(events, event)
      ? `${day}(${pathStepLabel(event.pathStep, event.pathStepName)})`
      : String(day);
    for (const unit of event.oatUnits) {
      labels.set(unit.unitKey, [...(labels.get(unit.unitKey) ?? []), label]);
    }
  }
  return new Map([...labels].filter(([, v]) => v.length > 1));
}

/**
 * 名前が同じで識別子が別々のアウトカムを続きにまとめる(続きの仕組みより前に作った定義や、
 * 病日ごとに手で同じアウトカムを入れた定義のため)。まとめた件数(識別子を付け替えた行の数)を返す。
 *
 * ［決定］アウトカムは名前が同じなら、最初に現れた病日の識別子に揃える。観察項目はその続きの中で名前が
 * 同じもの、タスクは続きの中で大分類・名前・オーダー雛形が同じものを揃える(雛形が違うタスクを
 * まとめると、出るオーダーが変わってしまう)。同じ病日(同じ OAT ユニット)の中に同じ名前が 2 つあるときは、
 * 後のものをそのまま残す。揃えた後の名前・コードなどは、最初に現れた病日の値に合わせる(propagateSeries)。
 * 適正値は病日ごとの値を保つ。
 */
export function linkSameNameSeries(events: PathwayEventDraft[]): { events: PathwayEventDraft[]; linked: number } {
  const sorted = sortEventsByDay(events);
  const unitKeyByName = new Map<string, string>();
  const assessmentKeyByName = new Map<string, string>();
  const taskKeyBySignature = new Map<string, string>();
  let linked = 0;

  const relinked = new Map<number, PathwayEventDraft>();
  for (const event of sorted) {
    const usedUnitKeys = new Set(event.oatUnits.map((u) => u.unitKey));
    const oatUnits = event.oatUnits.map((unit) => {
      const name = unit.name.trim();
      let unitKey = unit.unitKey;
      if (name) {
        const canonical = unitKeyByName.get(name);
        if (!canonical) unitKeyByName.set(name, unitKey);
        else if (canonical !== unitKey && !usedUnitKeys.has(canonical)) {
          usedUnitKeys.delete(unitKey);
          usedUnitKeys.add(canonical);
          unitKey = canonical;
          linked++;
        }
      }

      const usedAssessmentKeys = new Set(unit.assessments.map((a) => a.assessmentKey));
      const renamedAssessments = new Map<string, string>();
      const assessments = unit.assessments.map((a) => {
        const aName = a.name.trim();
        if (!aName) return a;
        const id = `${unitKey}/${aName}`;
        const canonical = assessmentKeyByName.get(id);
        if (!canonical) {
          assessmentKeyByName.set(id, a.assessmentKey);
          return a;
        }
        if (canonical === a.assessmentKey || usedAssessmentKeys.has(canonical)) return a;
        usedAssessmentKeys.delete(a.assessmentKey);
        usedAssessmentKeys.add(canonical);
        renamedAssessments.set(a.assessmentKey, canonical);
        linked++;
        return { ...a, assessmentKey: canonical };
      });

      const usedTaskKeys = new Set(unit.tasks.map((t) => t.taskKey));
      const tasks = unit.tasks.map((t) => {
        const assessmentKey = renamedAssessments.get(t.assessmentKey) ?? t.assessmentKey;
        const tName = t.name.trim();
        const next = assessmentKey === t.assessmentKey ? t : { ...t, assessmentKey };
        if (!tName) return next;
        const signature = `${unitKey}/${t.categoryLv1}/${tName}/${JSON.stringify(t.template ?? null)}`;
        const canonical = taskKeyBySignature.get(signature);
        if (!canonical) {
          taskKeyBySignature.set(signature, t.taskKey);
          return next;
        }
        if (canonical === t.taskKey || usedTaskKeys.has(canonical)) return next;
        usedTaskKeys.delete(t.taskKey);
        usedTaskKeys.add(canonical);
        linked++;
        return { ...next, taskKey: canonical };
      });

      return { ...unit, unitKey, assessments, tasks };
    });
    relinked.set(event.key, { ...event, oatUnits });
  }
  if (linked === 0) return { events, linked };

  // 付け替えた続きの名前・コード・雛形などを、最初に現れた病日の値に揃える。最初に現れたものだけを
  // 集めた仮の病日を写し元にして propagateSeries に渡し、終わったら外す。
  const firstUnits = new Map<string, PathwayOatUnitDraft>();
  const firstAssessments = new Map<string, PathwayAssessmentDraft>();
  const firstTasks = new Map<string, PathwayTaskDraft>();
  for (const event of sortEventsByDay([...relinked.values()])) {
    for (const unit of event.oatUnits) {
      if (!firstUnits.has(unit.unitKey)) firstUnits.set(unit.unitKey, { ...unit, assessments: [], tasks: [] });
      for (const a of unit.assessments) if (!firstAssessments.has(a.assessmentKey)) firstAssessments.set(a.assessmentKey, a);
      for (const t of unit.tasks) if (!firstTasks.has(t.taskKey)) firstTasks.set(t.taskKey, t);
    }
  }
  const source: PathwayEventDraft = {
    ...emptyEventDraft(1),
    oatUnits: [
      ...firstUnits.values(),
      // 観察項目・タスクは OAT ユニットをまたいで識別子で引くので、1 つの入れ物にまとめて渡す。
      { ...emptyOatUnitDraft(), assessments: [...firstAssessments.values()], tasks: [...firstTasks.values()] },
    ],
  };
  const next = propagateSeries([source, ...events.map((e) => relinked.get(e.key) ?? e)], source.key).slice(1);
  return { events: next, linked };
}
