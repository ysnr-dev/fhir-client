import { addDays, dateTimeLabel, localDay } from "../lib/dates";
import { excludeNursingProblems } from "./conditionHelpers";
import { ADMISSION_CLASS_CODE, ADMISSION_STATUS, DISCHARGED_STATUS } from "./encounterHelpers";
import {
  ADMISSION_DATE_MODES,
  ageToBirthDateRange,
  appendRange,
  CLINICAL_STATUS_OPTIONS,
  EXTRACT_ORDER_STAGES,
  EXTRACT_ORDER_TYPES,
  EXTRACT_VALUE_OPS,
  resolvePeriod,
  withCodes,
  type ExtractKind,
  type ExtractLeaf,
  type ExtractRecord,
  type LeafSearch,
} from "./extractQueryModel";
import { departmentOf, ORDER_TYPE_SYSTEM } from "./orderHeader";
import { ORDER_KIND_CORE, ORDER_KINDS, type OrderKind } from "./orderKinds";
import { OUTPATIENT_CLASS_CODE } from "./outpatientEncounterHelpers";
import { genderLabel } from "./patientHelpers";
import { conceptLabel, quantityLabel } from "./shared";

// データ抽出の条件の種類ごとの対応表(docs/data-extract-design.md §2・§3)。種類を足すときは
// extractQueryModel.ts の EXTRACT_KINDS に 1 行足し、型エラーになったここと
// components/extract/ExtractLeafFields.tsx の入力欄の表、backend の ExtractQuery の定数を埋める。

/** 明細 CSV の、条件の列より後ろの列(全種類で共通の 1 つの表にする)。 */
export interface DetailFields {
  kind: string;
  date?: string;
  end?: string;
  code?: string;
  name?: string;
  value?: string | number;
  unit?: string;
  interpretation?: string;
  range?: string;
  status?: string;
  recorded?: string;
  dose?: string;
  usage?: string;
  days?: string | number;
  department?: string;
  id?: string;
}

export const DETAIL_COLUMNS: [keyof DetailFields, string][] = [
  ["kind", "種類"],
  ["date", "日付"],
  ["end", "終了日"],
  ["code", "コード"],
  ["name", "名称"],
  ["value", "値"],
  ["unit", "単位"],
  ["interpretation", "判定"],
  ["range", "基準値"],
  ["status", "状態"],
  ["recorded", "登録日"],
  ["dose", "用量"],
  ["usage", "用法"],
  ["days", "日数"],
  ["department", "診療科"],
  ["id", "記録ID"],
];

export interface ExtractKindDef<R extends ExtractRecord> {
  /** 「＋条件」の選択肢と条件の見出し。 */
  label: string;
  /** 新しい条件の初期値(key・kind 以外)。 */
  initial(): Partial<ExtractLeaf>;
  /**
   * 手で付けた名前が無いときの表示名。names は選んだ項目の名前、period は期間・時間関係・件数を
   * まとめたもの(どちらも空のことがある)。
   */
  describe(leaf: ExtractLeaf, names: string, period: string): string;
  /** 種類ごとの入力の誤り(条件名を前に付けて出す)。 */
  validate(leaf: ExtractLeaf): string[];
  /** 条件 1 つぶんの上流の検索。返す項目は一覧の列に要るものだけ(_elements)。 */
  search(leaf: ExtractLeaf, today: string): LeafSearch;
  recordDate(leaf: ExtractLeaf, record: R): string;
  /** 一覧の「最新」に出す中身。 */
  recordContent(record: R): string;
  /** 内訳の診療科別に使う診療科名。 */
  recordDepartment(record: R): string;
  /** 記録の終了日(YYYY-MM-DD)。時間関係の基準を終了日にできる種類だけが持つ。 */
  endDay?(record: R): string;
  /** 時間関係の基準にしたとき「終了日」を選べるか。 */
  hasEndDay?(leaf: ExtractLeaf): boolean;
  detail(record: R): DetailFields;
}

interface RecordOf {
  patient: fhir4.Patient;
  condition: fhir4.Condition;
  observation: fhir4.Observation;
  medication: fhir4.MedicationRequest;
  order: fhir4.ServiceRequest | fhir4.Procedure;
  admission: fhir4.Encounter;
  outpatient: fhir4.Encounter;
}

const firstCode = (concept: fhir4.CodeableConcept | undefined) => concept?.coding?.[0]?.code ?? "";

const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ");

const CLINICAL_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  CLINICAL_STATUS_OPTIONS.map((o) => [o.value, o.label]),
);

// ---- 部門オーダー ----

/**
 * 実施を Procedure(category = order-type)で記録する種別。検体検査・細菌・病理・食事・他科依頼は
 * 実施の Procedure を書かない。放射線治療は照射ごとの Procedure と同じ category に治療終了サマリーも
 * 載り、上流の category 索引(先頭の coding だけ)では分けられないので、実施の条件にはしない。
 */
const PERFORMED_ORDER_KINDS: ReadonlySet<OrderKind> = new Set<OrderKind>([
  "rad-order",
  "physio-order",
  "endoscopy-order",
  "treatment-order",
  "surgery-order",
  "transfusion-order",
  "rehab-order",
  "nutrition-guidance-order",
  "medication-guidance-order",
]);

export interface ExtractOrderKind {
  kind: OrderKind;
  /** 条件に保存する order-type のコード。 */
  code: string;
  label: string;
  /** 実施(Procedure)でも数えられるか。 */
  performed: boolean;
}

export const EXTRACT_ORDER_KINDS: ExtractOrderKind[] = ORDER_KINDS.map((kind) => ({
  kind,
  code: ORDER_KIND_CORE[kind].orderType.code,
  label: ORDER_KIND_CORE[kind].label,
  performed: PERFORMED_ORDER_KINDS.has(kind),
}));

export function extractOrderKindOf(code: string | undefined): ExtractOrderKind | undefined {
  return EXTRACT_ORDER_KINDS.find((k) => k.code === code);
}

// 記録の状態(status)の表示名。表に無い値はコードのまま出す。
const OBSERVATION_STATUS: Record<string, string> = {
  final: "確定",
  preliminary: "速報",
  amended: "訂正",
  corrected: "訂正",
  registered: "登録",
};
const MEDICATION_REQUEST_STATUS: Record<string, string> = {
  active: "有効",
  completed: "終了",
  stopped: "中止",
  "on-hold": "保留",
  draft: "下書き",
};
const SERVICE_REQUEST_STATUS: Record<string, string> = {
  active: "依頼",
  completed: "完了",
  "on-hold": "保留",
  revoked: "中止",
};
const PROCEDURE_STATUS: Record<string, string> = { completed: "実施済", stopped: "中断" };

function orderKindLabel(record: fhir4.ServiceRequest | fhir4.Procedure): string {
  const categories = record.resourceType === "Procedure" ? [record.category] : (record.category ?? []);
  const code = categories
    .flatMap((c) => c?.coding ?? [])
    .find((c) => c.system === ORDER_TYPE_SYSTEM)?.code;
  return extractOrderKindOf(code)?.label ?? "";
}

function procedureStart(record: fhir4.Procedure): string {
  return record.performedDateTime ?? record.performedPeriod?.start ?? "";
}

// ---- 対応表 ----

export const EXTRACT_KIND_DEFS: { [K in ExtractKind]: ExtractKindDef<RecordOf[K]> } = {
  patient: {
    label: "患者属性",
    initial: () => ({ gender: [], age: { min: null, max: null } }),
    describe(leaf) {
      const gender = (leaf.gender ?? []).map(genderLabel).join("・");
      const { min, max } = leaf.age ?? {};
      const age =
        min != null && max != null ? `${min}〜${max}歳` : min != null ? `${min}歳以上` : max != null ? `${max}歳以下` : "";
      return join(gender, age) || "患者属性";
    },
    validate: (leaf) =>
      !(leaf.gender ?? []).length && leaf.age?.min == null && leaf.age?.max == null ? ["性別か年齢を入れてください。"] : [],
    search(leaf, today) {
      const params = new URLSearchParams();
      if ((leaf.gender ?? []).length) params.set("gender", (leaf.gender ?? []).join(","));
      const birth = ageToBirthDateRange(leaf.age, today);
      if (birth.le) params.append("birthdate", `le${birth.le}`);
      if (birth.gt) params.append("birthdate", `gt${birth.gt}`);
      params.set("active:not", "false");
      params.set("_elements", "gender,birthDate");
      return { resourceType: "Patient", paramsList: [params] };
    },
    recordDate: () => "",
    recordContent: () => "",
    recordDepartment: () => "",
    detail: () => ({ kind: "患者属性" }),
  },

  condition: {
    label: "病名",
    initial: () => ({ codes: [], clinical_status: ["active"], date_field: "onset", period: null }),
    describe: (_leaf, names, period) => join(names || "病名", period),
    validate: (leaf) => ((leaf.codes ?? []).length ? [] : ["項目を選んでください。"]),
    search(leaf, today) {
      const range = resolvePeriod(leaf.period, today);
      return {
        resourceType: "Condition",
        paramsList: withCodes(leaf.codes ?? [], (code) => {
          const params = new URLSearchParams();
          params.set("code", code);
          if ((leaf.clinical_status ?? []).length) params.set("clinical-status", (leaf.clinical_status ?? []).join(","));
          params.set("verification-status:not", "entered-in-error,refuted");
          excludeNursingProblems(params);
          // 病名の開始日は onsetDateTime(この画面の病名登録は recordedDate を書かない)。登録日は他の
          // システムから来た病名のため。
          appendRange(params, leaf.date_field === "recorded" ? "recorded-date" : "onset-date", range);
          params.set("_elements", "subject,code,recordedDate,onsetDateTime,extension");
          return params;
        }),
      };
    },
    recordDate: (leaf, record) =>
      (leaf.date_field === "recorded" ? record.recordedDate : record.onsetDateTime) ??
      record.onsetDateTime ??
      record.recordedDate ??
      "",
    recordContent: (record) => conceptLabel(record.code),
    recordDepartment: (record) => departmentOf(record).departmentName,
    detail(record) {
      const status = record.clinicalStatus?.coding?.[0]?.code ?? "";
      return {
        kind: "病名",
        date: localDay(record.onsetDateTime ?? record.recordedDate),
        end: localDay(record.abatementDateTime),
        code: firstCode(record.code),
        name: conceptLabel(record.code),
        status: CLINICAL_STATUS_LABELS[status] ?? status,
        recorded: localDay(record.recordedDate),
        department: departmentOf(record).departmentName,
        id: record.id,
      };
    },
  },

  observation: {
    label: "検査結果・バイタル",
    initial: () => ({ codes: [], period: { mode: "relative", days: 365 }, value: null }),
    describe(leaf, names, period) {
      const op = EXTRACT_VALUE_OPS.find((o) => o.value === leaf.value?.op)?.label;
      return join(names || "検査", leaf.value ? `${leaf.value.value}${op ?? ""}` : "", period);
    },
    validate: (leaf) => ((leaf.codes ?? []).length ? [] : ["項目を選んでください。"]),
    search(leaf, today) {
      const range = resolvePeriod(leaf.period, today);
      return {
        resourceType: "Observation",
        paramsList: withCodes(leaf.codes ?? [], (code) => {
          const params = new URLSearchParams();
          params.set("code", code);
          appendRange(params, "date", range);
          if (leaf.value) params.set("value-quantity", `${leaf.value.op}${leaf.value.value}`);
          params.set("status:not", "entered-in-error,cancelled");
          params.set("_elements", "subject,code,effectiveDateTime,valueQuantity,extension");
          return params;
        }),
      };
    },
    recordDate: (_leaf, record) => record.effectiveDateTime ?? "",
    recordContent: (record) => quantityLabel(record.valueQuantity),
    recordDepartment: (record) => departmentOf(record).departmentName,
    detail: (record) => ({
      kind: "検査結果",
      date: dateTimeLabel(record.effectiveDateTime),
      code: firstCode(record.code),
      name: conceptLabel(record.code),
      value: record.valueQuantity?.value ?? "",
      unit: record.valueQuantity?.unit,
      interpretation: record.interpretation?.[0]?.coding?.[0]?.code,
      range: record.referenceRange?.[0]?.text,
      status: OBSERVATION_STATUS[record.status] ?? record.status,
      department: departmentOf(record).departmentName,
      id: record.id,
    }),
  },

  medication: {
    label: "処方・注射",
    initial: () => ({ codes: [], period: { mode: "relative", days: 365 } }),
    describe(leaf, names, period) {
      const orderType = EXTRACT_ORDER_TYPES.find((t) => t.value === leaf.order_type)?.label;
      return join(orderType, names || "薬剤", period);
    },
    validate: (leaf) =>
      (leaf.codes ?? []).length || (leaf.drug_classes ?? []).length ? [] : ["項目を選んでください。"],
    search(leaf, today) {
      const range = resolvePeriod(leaf.period, today);
      return {
        resourceType: "MedicationRequest",
        paramsList: withCodes(leaf.codes ?? [], (code) => {
          const params = new URLSearchParams();
          params.set("code", code);
          appendRange(params, "authoredon", range);
          // 処方と注射はオーダーのヘッダ(ServiceRequest)の order-type でしか分からないので、
          // based-on のチェーンで引く。
          if (leaf.order_type) params.set("based-on.category", `${ORDER_TYPE_SYSTEM}|${leaf.order_type}`);
          params.set("status:not", "entered-in-error,cancelled");
          params.set("_elements", "subject,authoredOn,medicationCodeableConcept,extension");
          return params;
        }),
      };
    },
    recordDate: (_leaf, record) => record.authoredOn ?? "",
    recordContent: (record) => conceptLabel(record.medicationCodeableConcept),
    recordDepartment: (record) => departmentOf(record).departmentName,
    detail(record) {
      const dosage = record.dosageInstruction?.[0];
      const dose = dosage?.doseAndRate?.[0]?.doseQuantity;
      return {
        kind: "処方・注射",
        date: dateTimeLabel(record.authoredOn),
        code: firstCode(record.medicationCodeableConcept),
        name: conceptLabel(record.medicationCodeableConcept),
        status: MEDICATION_REQUEST_STATUS[record.status] ?? record.status,
        dose: dose?.value != null ? `${dose.value}${dose.unit ?? ""}` : "",
        usage: dosage?.text,
        days: record.dispenseRequest?.expectedSupplyDuration?.value ?? "",
        department: departmentOf(record).departmentName,
        id: record.id,
      };
    },
  },

  order: {
    label: "部門オーダー",
    initial: () => ({
      order_kind: EXTRACT_ORDER_KINDS[0].code,
      stage: "ordered",
      codes: [],
      period: { mode: "relative", days: 90 },
    }),
    describe(leaf, names, period) {
      const kind = extractOrderKindOf(leaf.order_kind)?.label ?? "部門オーダー";
      const stage = EXTRACT_ORDER_STAGES.find((s) => s.value === (leaf.stage ?? "ordered"))?.label;
      return join(leaf.department_name, names || kind, stage, period);
    },
    validate(leaf) {
      const kind = extractOrderKindOf(leaf.order_kind);
      if (!kind) return ["オーダーの種別を選んでください。"];
      if (leaf.stage === "performed" && !kind.performed) return [`${kind.label}は実施で数えられません。`];
      if (leaf.stage === "performed" && (leaf.codes ?? []).length) return ["実施では項目を選べません。"];
      return [];
    },
    search(leaf, today) {
      const range = resolvePeriod(leaf.period, today);
      const category = `${ORDER_TYPE_SYSTEM}|${leaf.order_kind ?? ""}`;
      const department = leaf.department_id ? `Organization/${leaf.department_id}` : "";
      if (leaf.stage === "performed") {
        // 1 回の実施はハブの Procedure 1 件(2 件目以降の手技は partOf でぶら下がる)。依頼科は
        // 実施の元のオーダー(basedOn)のヘッダが持つ。
        const params = new URLSearchParams();
        params.set("category", category);
        params.set("status", "completed");
        params.set("part-of:missing", "true");
        appendRange(params, "date", range);
        if (department) params.set("based-on.department", department);
        params.set("_elements", "subject,category,code,performedDateTime,performedPeriod,status");
        return { resourceType: "Procedure", paramsList: [params] };
      }
      // オーダー 1 件はヘッダ 1 件(明細はヘッダを basedOn で指す)。日付・状態・依頼科を確かに持つのは
      // ヘッダだけなので、項目で絞るときもヘッダを引き、項目は明細の code を _has で当てる(セットの
      // 構成項目はセット親の下にあるので当たらない)。
      const base = () => {
        const params = new URLSearchParams();
        params.set("category", category);
        params.set("based-on:missing", "true");
        params.set("status:not", "revoked,entered-in-error,draft");
        appendRange(params, "occurrence", range);
        if (department) params.set("department", department);
        params.set("_elements", "subject,category,code,occurrenceDateTime,authoredOn,status,extension");
        return params;
      };
      const codes = leaf.codes ?? [];
      return {
        resourceType: "ServiceRequest",
        paramsList: codes.length
          ? withCodes(codes, (code) => {
              const params = base();
              params.set("_has:ServiceRequest:based-on:code", code);
              return params;
            })
          : [base()],
      };
    },
    recordDate: (_leaf, record) =>
      record.resourceType === "Procedure" ? procedureStart(record) : (record.occurrenceDateTime ?? record.authoredOn ?? ""),
    recordContent: (record) => conceptLabel(record.code) || orderKindLabel(record),
    recordDepartment: (record) => (record.resourceType === "Procedure" ? "" : departmentOf(record).departmentName),
    endDay: (record) => (record.resourceType === "Procedure" ? localDay(record.performedPeriod?.end) : ""),
    hasEndDay: (leaf) => leaf.stage === "performed",
    detail(record) {
      const kind = orderKindLabel(record);
      if (record.resourceType === "Procedure") {
        return {
          kind: join(kind, "実施"),
          date: dateTimeLabel(procedureStart(record)),
          end: localDay(record.performedPeriod?.end),
          code: firstCode(record.code),
          name: conceptLabel(record.code),
          status: PROCEDURE_STATUS[record.status] ?? record.status,
          id: record.id,
        };
      }
      return {
        kind: join(kind, "依頼"),
        date: dateTimeLabel(record.occurrenceDateTime),
        code: firstCode(record.code),
        name: conceptLabel(record.code),
        status: SERVICE_REQUEST_STATUS[record.status] ?? record.status,
        recorded: localDay(record.authoredOn),
        department: departmentOf(record).departmentName,
        id: record.id,
      };
    },
  },

  admission: {
    label: "入院",
    initial: () => ({ date_mode: "overlap", period: { mode: "relative", days: 30 } }),
    describe(leaf, _names, period) {
      const mode = ADMISSION_DATE_MODES.find((m) => m.value === leaf.date_mode)?.label ?? "入院";
      return join(leaf.department_name, leaf.ward_name, mode, period);
    },
    validate: (leaf) => (leaf.period ? [] : ["期間を入れてください。"]),
    search(leaf, today) {
      const range = resolvePeriod(leaf.period, today);
      const params = new URLSearchParams();
      params.set("class", ADMISSION_CLASS_CODE);
      params.set("status", `${ADMISSION_STATUS},${DISCHARGED_STATUS}`);
      // Encounter.date は入院期間との比較。sa / eb で入院日・退院日だけを見る。
      if (leaf.date_mode === "admitted") {
        if (range?.from) params.append("date", `sa${addDays(range.from, -1)}`);
        if (range?.to) params.append("date", `le${range.to}`);
      } else if (leaf.date_mode === "discharged") {
        if (range?.from) params.append("date", `ge${range.from}`);
        params.append("date", `eb${addDays(range?.to ?? today, 1)}`);
      } else {
        appendRange(params, "date", range);
      }
      if (leaf.department_id) params.set("service-provider", `Organization/${leaf.department_id}`);
      // Encounter.location はベッド。ベッド → 病室 → 病棟と partOf を辿るチェーンで病棟に絞る
      // (転棟前のベッドも location に残るので、期間中にその病棟にいたことがある入院が当たる)。
      if (leaf.ward_id) params.set("location.partof.partof", `Location/${leaf.ward_id}`);
      params.set("_elements", "subject,period,serviceProvider");
      return { resourceType: "Encounter", paramsList: [params] };
    },
    recordDate: (_leaf, record) => record.period?.start ?? "",
    recordContent: encounterPeriodLabel,
    recordDepartment: (record) => record.serviceProvider?.display ?? "",
    endDay: (record) => localDay(record.period?.end),
    hasEndDay: () => true,
    detail: (record) => encounterDetail(record, "入院"),
  },

  outpatient: {
    label: "外来受診",
    initial: () => ({ period: { mode: "relative", days: 30 } }),
    describe: (_leaf, _names, period) => join("外来受診", period),
    validate: (leaf) => (leaf.period ? [] : ["期間を入れてください。"]),
    search(leaf, today) {
      const params = new URLSearchParams();
      params.set("class", OUTPATIENT_CLASS_CODE);
      params.set("status:not", "cancelled,entered-in-error");
      appendRange(params, "date", resolvePeriod(leaf.period, today));
      params.set("_elements", "subject,period");
      return { resourceType: "Encounter", paramsList: [params] };
    },
    recordDate: (_leaf, record) => record.period?.start ?? "",
    recordContent: encounterPeriodLabel,
    recordDepartment: (record) => record.serviceProvider?.display ?? "",
    endDay: (record) => localDay(record.period?.end),
    hasEndDay: () => true,
    detail: (record) => encounterDetail(record, "外来受診"),
  },
};

function encounterPeriodLabel(record: fhir4.Encounter): string {
  const start = localDay(record.period?.start);
  const end = localDay(record.period?.end);
  return end ? `${start}〜${end}` : `${start}〜`;
}

const ENCOUNTER_STATUS: Record<string, string> = {
  "in-progress": "入院中",
  finished: "終了",
  planned: "予定",
  arrived: "来院",
};

function encounterDetail(record: fhir4.Encounter, kind: string): DetailFields {
  return {
    kind,
    date: localDay(record.period?.start),
    end: localDay(record.period?.end),
    status: ENCOUNTER_STATUS[record.status] ?? record.status,
    department: record.serviceProvider?.display,
    id: record.id,
  };
}

/**
 * 条件の種類の定義。記録はその種類の検索で返ったものしか渡さないので、記録の型はここで広げる
 * (対応表の側は種類ごとの型で書ける)。
 */
export function extractKindDef(kind: ExtractKind): ExtractKindDef<ExtractRecord> {
  return EXTRACT_KIND_DEFS[kind] as unknown as ExtractKindDef<ExtractRecord>;
}
