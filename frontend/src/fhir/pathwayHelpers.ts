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

export interface PathwayEventDraft {
  key: number;
  elapsedDays: string;
  pathStep: number;
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
    events: [],
  };
}

export function emptyEventDraft(elapsedDays: number): PathwayEventDraft {
  return { key: newDraftKey(), elapsedDays: String(elapsedDays), pathStep: 1, title: "", note: "", oatUnits: [] };
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
    events: detail.events.map((e) => ({
      key: newDraftKey(),
      elapsedDays: String(e.elapsed_days),
      pathStep: e.path_step,
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
    elapsed_days: numOrNull(event.elapsedDays) ?? 0,
    path_step: event.pathStep,
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
    events: sortEventsByDay(draft.events).map(eventPayload),
  };
}

// ---- 病日の操作 ----

export function eventDayOf(event: Pick<PathwayEventDraft, "elapsedDays">): number | null {
  const n = numOrNull(event.elapsedDays);
  return n !== null && Number.isInteger(n) ? n : null;
}

/** 病日順に並べる(書式が不正な行は末尾)。 */
export function sortEventsByDay(events: PathwayEventDraft[]): PathwayEventDraft[] {
  return events
    .map((e, index) => ({ e, index, day: eventDayOf(e) }))
    .sort((a, b) => {
      if (a.day === null && b.day === null) return a.index - b.index;
      if (a.day === null) return 1;
      if (b.day === null) return -1;
      return a.day - b.day || a.e.pathStep - b.e.pathStep || a.index - b.index;
    })
    .map((x) => x.e);
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

/** 病日を複製する。識別子は適用後まで持ち越すものなので、必ず採り直す。 */
export function copyEventDraft(event: PathwayEventDraft, elapsedDays: number): PathwayEventDraft {
  return {
    ...event,
    key: newDraftKey(),
    elapsedDays: String(elapsedDays),
    title: "",
    oatUnits: event.oatUnits.map((u) => {
      const assessmentKeys = new Map<string, string>();
      const assessments = u.assessments.map((a) => {
        const assessmentKey = newPathwayUuid();
        assessmentKeys.set(a.assessmentKey, assessmentKey);
        return { ...a, key: newDraftKey(), assessmentKey };
      });
      return {
        ...u,
        key: newDraftKey(),
        unitKey: newPathwayUuid(),
        assessments,
        tasks: u.tasks.map((t) => ({
          ...t,
          key: newDraftKey(),
          taskKey: newPathwayUuid(),
          assessmentKey: assessmentKeys.get(t.assessmentKey) ?? "",
        })),
      };
    }),
  };
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
    if (seen.has(id)) return `病日 ${id} が重複しています`;
    seen.add(id);
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

export interface OverviewRow {
  label: string;
  /** その行が載る病日(elapsed_days)。 */
  days: Set<number>;
  critical: boolean;
}

export interface OverviewRows {
  days: { day: number; label: string }[];
  outcomes: OverviewRow[];
  taskGroups: { lv1: PathwayTaskCategoryLv1; label: string; rows: OverviewRow[] }[];
}

/** 概要表の行。アウトカムは名前、タスクは(大分類, 名前)でまとめる。 */
export function overviewRows(draft: PathwayDraft): OverviewRows {
  const events = sortEventsByDay(draft.events).filter((e) => eventDayOf(e) !== null);
  const days = events.map((e) => {
    const day = eventDayOf(e) as number;
    return { day, label: eventDayLabel(day, e.title) };
  });
  const outcomes = new Map<string, OverviewRow>();
  const tasks = new Map<PathwayTaskCategoryLv1, Map<string, OverviewRow>>();
  for (const event of events) {
    const day = eventDayOf(event) as number;
    for (const unit of event.oatUnits) {
      const name = unit.name.trim() || "(名称未入力)";
      const row = outcomes.get(name) ?? { label: name, days: new Set<number>(), critical: false };
      row.days.add(day);
      row.critical = row.critical || unit.critical;
      outcomes.set(name, row);
      for (const task of unit.tasks) {
        const group = tasks.get(task.categoryLv1) ?? new Map<string, OverviewRow>();
        const taskName = task.name.trim() || "(名称未入力)";
        const taskRow = group.get(taskName) ?? { label: taskName, days: new Set<number>(), critical: false };
        taskRow.days.add(day);
        group.set(taskName, taskRow);
        tasks.set(task.categoryLv1, group);
      }
    }
  }
  return {
    days,
    outcomes: [...outcomes.values()],
    taskGroups: TASK_CATEGORY_LV1_OPTIONS.filter((o) => tasks.has(o.code)).map((o) => ({
      lv1: o.code,
      label: o.display,
      rows: [...(tasks.get(o.code) as Map<string, OverviewRow>).values()],
    })),
  };
}
