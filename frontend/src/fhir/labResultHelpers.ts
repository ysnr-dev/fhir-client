import { today } from "../lib/dates";
import { categoryCoding, codingBySystem, findSettingDisplay, SETTING_OPTIONS } from "./shared";

export { SETTING_OPTIONS };
import type { LabReferenceRange, LabResultItem } from "../api/masterClient";
import {
  buildPanicTask,
  hasPanicValue,
  panicItemsOf,
  panicSummaryOf,
} from "./labPanicHelpers";
import { buildCancelledNotificationTask } from "./notificationHelpers";
import { calculateAge } from "./patientHelpers";
import { departmentExtension, departmentOf } from "./prescriptionHelpers";

// ローカル拡張・コードシステム。正式な CodeSystem が定義されていない(または
// 不明な)項目を表現するための、この検査結果機能専用の URI。
// 入外区分。細菌検査結果(microResultHelpers)も同じ意味で使うので共有する。
export const SETTING_SYSTEM = "http://fhir-client.local/CodeSystem/lab-result-setting";
// 結果項目コード(検体検査の結果項目マスタ、施設採番)。Observation.code の先頭に置き、
// 読み出し・時系列の突き合わせのキーにする。オーダー側の lab-order-item と同じ流儀。
export const RESULT_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/lab-result-item";
// JLAC11 コード。正式な CodeSystem URL が公開されていないためローカル URI を使用。
// 検体検査オーダー(labOrderHelpers)も同じ体系のコードを持つので共有する。
export const JLAC11_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11";
// JLAC10 コード。JLAC11 と同じくローカル URI。
export const JLAC10_SYSTEM = "http://fhir-client.local/CodeSystem/jlac10";
// JLAC11 の材料(検体)コード。同じく正式な CodeSystem URL がないためローカル URI。
export const JLAC11_SPECIMEN_SYSTEM = "http://fhir-client.local/CodeSystem/jlac11-specimen";
// 検査項目の略称。詳細表示・編集フォームへの復元に使う補助 coding。
// 検体検査オーダー(labOrderHelpers)も同じ用途で使うので共有する。
export const ABBREVIATION_SYSTEM = "http://fhir-client.local/CodeSystem/lab-item-abbreviation";
// 検体ラベル番号(Specimen.accessionIdentifier)。ラベル発行(backend の LabLabelNumber)が
// 採番し、到着確認(labSpecimenHelpers)がスキャンで引く。
export const LAB_LABEL_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/lab-label-number";

/**
 * ラベル発行が作った Specimen(採取管の台帳)かどうか。
 *
 * ラベル由来の Specimen はオーダー側(発行・到着確認)が所有していて、結果登録は
 * 参照するだけで書き換え・削除しない。結果登録が自分で作る Specimen(オーダー
 * 未紐付けの結果や、ラベルの無い材料)はラベル番号を持たないので、これで見分ける。
 */
export function isLabelSpecimen(specimen: fhir4.Specimen): boolean {
  return specimen.accessionIdentifier?.system === LAB_LABEL_NUMBER_SYSTEM;
}

/**
 * 報告区分。中間報告(preliminary)→ 最終報告(final)→ 確定後に値を直したら訂正(corrected)。
 * 訂正への遷移は build 側が行うので、フォームの選択肢は中間・最終の 2 つ(病理
 * pathoResultHelpers・診療記録 clinicalNoteHelpers と同じ規約)。
 *
 * 病理は修正を amended で表すが、検体検査は corrected を使う。検体検査の訂正報告は
 * JAHIS 臨床検査データ交換規約(HL7 v2 の OBX-11 = "C" 訂正)に当たる概念で、
 * FHIR でこれに対応するコードが corrected のため。
 */
export type LabReportStatus = "preliminary" | "final" | "corrected";

export const REPORT_STATUS_OPTIONS: { code: "preliminary" | "final"; display: string }[] = [
  { code: "preliminary", display: "中間報告" },
  { code: "final", display: "最終報告" },
];

export function labReportStatusDisplay(status: string | undefined): string {
  // amended は病理・診療記録の語彙だが、外から届いた結果にあり得るので訂正として読む。
  if (status === "corrected" || status === "amended") return "訂正報告";
  return REPORT_STATUS_OPTIONS.find((o) => o.code === status)?.display ?? "";
}

/** 中間報告のまま確定していない結果か(カルテのカード・累積表の印に使う)。 */
export function isPreliminaryReport(status: string | undefined): boolean {
  return status === "preliminary";
}

/** 訂正された結果か(同上)。 */
export function isCorrectedReport(status: string | undefined): boolean {
  return status === "corrected" || status === "amended";
}

/** 最終報告か(中間・訂正だけを目立たせるための判定)。 */
export function isFinalReport(status: string | undefined): boolean {
  return status === "final";
}

/**
 * 保存後の報告区分。確定(final)・訂正済(corrected)の結果を編集保存したら訂正へ遷移させる。
 * 確定した結果を直したのに final のままだと、後から見て「一度も直していない結果」と
 * 区別が付かなくなるため。
 */
export function nextLabReportStatus(values: LabResultFormValues): LabReportStatus {
  const original = values.originalStatus;
  return original && !isPreliminaryReport(original) ? "corrected" : values.reportStatus;
}

/**
 * 実施施設と実施者(DiagnosticReport.performer)。どこで・誰が測ったかは結果の読み方に
 * 効くので焼き付ける。実施施設は自院で固定(外注は docs/lab-backlog.md B-2 で未実装)、
 * 実施者は結果を登録したログインユーザー。編集では最初の実施者を残す。
 */
export interface LabResultPerformer {
  organizationId: string;
  organizationName: string;
  practitionerId: string;
  practitionerName: string;
}

export const emptyLabResultPerformer: LabResultPerformer = {
  organizationId: "",
  organizationName: "",
  practitionerId: "",
  practitionerName: "",
};

function buildPerformerReferences(performer: LabResultPerformer): fhir4.Reference[] {
  const references: fhir4.Reference[] = [];
  if (performer.organizationId) {
    references.push({
      reference: `Organization/${performer.organizationId}`,
      display: performer.organizationName || undefined,
    });
  }
  if (performer.practitionerId) {
    references.push({
      reference: `Practitioner/${performer.practitionerId}`,
      display: performer.practitionerName || undefined,
    });
  }
  return references;
}

function parsePerformer(report: fhir4.DiagnosticReport): LabResultPerformer {
  const performer = { ...emptyLabResultPerformer };
  for (const reference of report.performer ?? []) {
    const [type, id] = reference.reference?.split("/") ?? [];
    if (type === "Organization" && id) {
      performer.organizationId = id;
      performer.organizationName = reference.display ?? "";
    } else if (type === "Practitioner" && id) {
      performer.practitionerId = id;
      performer.practitionerName = reference.display ?? "";
    }
  }
  return performer;
}

// Observation.interpretation(H/L/N)。JP-CLINS の JP-Observation-LabResult-eCS が
// 参照する v3 ObservationInterpretation コードシステム。
export const INTERPRETATION_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";

const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";
// Observation.referenceRange.type(normal = 基準範囲)。
const REFERENCE_RANGE_MEANING_SYSTEM = "http://terminology.hl7.org/CodeSystem/referencerange-meaning";
const REPORT_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0074";
const LOINC_SYSTEM = "http://loinc.org";
const LOINC_LAB_REPORT_CODE = "11502-2"; // Laboratory report
export const UNITS_OF_MEASURE_SYSTEM = "http://unitsofmeasure.org";

// JP Core の検体検査結果プロファイル。
const OBSERVATION_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Observation_LabResult";
const REPORT_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_DiagnosticReport_LabResult";
const SPECIMEN_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Specimen_Common";

// 結果項目の材料(検体)コード。結果項目マスタが持つ JLAC11 材料コード 3 桁で、
// 空なら Specimen を作らない。
export function specimenCodeOf(item: LabResultItem | null | undefined): string {
  return item?.specimen_code ?? "";
}

// 結果項目の同一性キー。編集復元・オーダーからの展開・時系列の行まとめで、同じ結果項目を
// 1 つとして扱うために使う。施設コードを持たない骨格(結果項目マスタ導入前の保存済み
// 結果から復元したもの)は JLAC11、それも無ければ名称で代用する。
export function lineKeyOf(item: LabResultItem): string {
  if (item.result_item_code) return `item:${item.result_item_code}`;
  if (item.jlac11_code) return `jlac11:${item.jlac11_code}`;
  return `name:${item.name}`;
}

// 更新時に既存の Specimen を使い回すための、材料コード → リソース id の対応。
export interface SpecimenRef {
  code: string;
  id: string;
}

export type LabResultSetting = "inpatient" | "outpatient" | "";

// 結果値の判定。HH / LL はパニック値(緊急異常値)で、基準値を外れた H / L より重い。
// フォームでは未選択(空)を許し、FHIR には空を "N" として記録する。
export type LabInterpretation = "HH" | "H" | "L" | "LL" | "";

export const INTERPRETATION_OPTIONS: Exclude<LabInterpretation, "">[] = ["HH", "H", "L", "LL"];

const INTERPRETATION_DISPLAYS: Record<string, string> = {
  HH: "Critical high",
  H: "High",
  L: "Low",
  LL: "Critical low",
  N: "Normal",
};

/** パニック値(緊急異常値)の判定かどうか。 */
export function isPanicInterpretation(interpretation: string): boolean {
  return interpretation === "HH" || interpretation === "LL";
}

// 基準値の適用に要る患者の属性(性別と生年月日)。採取日の満年齢で年齢帯を選ぶ。
export interface LabResultSubject {
  gender?: string;
  birthDate?: string;
}

export function labResultSubjectOf(patient: fhir4.Patient | undefined): LabResultSubject | undefined {
  if (!patient) return undefined;
  return { gender: patient.gender, birthDate: patient.birthDate };
}

// 結果項目の基準値のうち、この患者・この採取日に適用する行。性別が一致(または共通)し、
// 採取日の満年齢が年齢帯に入る行のうち、マスタの並び(表示順)で先に来たもの。
// 性別・生年月日が分からない患者には、性別・年齢帯の指定が無い行だけが当たる。
export function matchReferenceRange(
  item: LabResultItem | null | undefined,
  subject: LabResultSubject | undefined,
  specimenDate: string,
): LabReferenceRange | undefined {
  const ranges = item?.reference_ranges ?? [];
  if (ranges.length === 0) return undefined;
  const gender = subject?.gender;
  const asOf = specimenDate ? new Date(specimenDate) : new Date();
  const age = subject?.birthDate
    ? calculateAge(subject.birthDate, Number.isNaN(asOf.getTime()) ? new Date() : asOf)
    : undefined;

  return ranges.find((range) => {
    if (range.sex && range.sex !== gender) return false;
    if (range.age_from != null && (age == null || age < range.age_from)) return false;
    if (range.age_to != null && (age == null || age > range.age_to)) return false;
    return true;
  });
}

// 結果値としきい値の突き合わせ。パニック値を外れていれば LL / HH、基準値を外れていれば
// L / H、範囲内(または判定できない)なら空。パニック値を先に見るのは、こちらが重いため。
export function judgeInterpretation(value: string, range: LabReferenceRange | undefined): LabInterpretation {
  if (!range || value.trim() === "") return "";
  const n = Number(value);
  if (Number.isNaN(n)) return "";
  if (range.panic_lower != null && n < Number(range.panic_lower)) return "LL";
  if (range.panic_upper != null && n > Number(range.panic_upper)) return "HH";
  if (range.lower_limit != null && n < Number(range.lower_limit)) return "L";
  if (range.upper_limit != null && n > Number(range.upper_limit)) return "H";
  return "";
}

// 「6.6〜8.1」「〜0.14」「3.3〜」。どちらも無ければ空。
export function referenceRangeLabel(
  lower: string | number | null | undefined,
  upper: string | number | null | undefined,
): string {
  const low = lower == null || lower === "" ? "" : String(Number(lower));
  const high = upper == null || upper === "" ? "" : String(Number(upper));
  if (!low && !high) return "";
  return `${low}〜${high}`;
}

// 保存済み Observation の基準値の表示(referenceRange の先頭)。
export function observationReferenceRangeLabel(obs: fhir4.Observation): string {
  const range = obs.referenceRange?.[0];
  if (!range) return "";
  return referenceRangeLabel(range.low?.value, range.high?.value);
}

export interface LabResultLineValues {
  id?: string;
  item: LabResultItem | null;
  // 結果値。PQ/ST は入力文字列、CD/CO は code_value_list 中の値コード。
  value: string;
  // H/L 判定。空値は FHIR 上 "N"(Normal) として記録する。
  interpretation: LabInterpretation;
  // 項目ごとのコメント(溶血・乳び・再検など)。空なら Observation.note を書かない。
  note: string;
}

export interface LabResultFormValues {
  setting: LabResultSetting;
  specimenDate: string;
  /**
   * 検査を行った診療科(Organization)の id。空なら未設定。
   * 検体検査オーダーに紐付ける場合は、オーダーの依頼科をそのまま採用する。
   */
  departmentId: string;
  departmentName: string;
  /**
   * 元になった検体検査オーダー(ヘッダの ServiceRequest)の id。空なら紐付けなし。
   * 紐付けは検査項目単位ではなく「オーダー 1 件 ↔ 結果レポート 1 件」で持つ。
   */
  orderId: string;
  /** 報告区分。フォームで選ぶのは中間・最終で、訂正は保存時に決まる(nextLabReportStatus)。 */
  reportStatus: "preliminary" | "final";
  /** 保存済みの報告区分。新規は空。訂正へ遷移させるかの判定にだけ使う。 */
  originalStatus: string;
  /** 検査室の総合所見(DiagnosticReport.conclusion)。 */
  conclusion: string;
  /** 実施施設・実施者。空欄は登録画面が自院とログインユーザーで埋める。 */
  performer: LabResultPerformer;
  lines: LabResultLineValues[];
}

export const emptyLabResultLine: LabResultLineValues = {
  item: null,
  value: "",
  interpretation: "",
  note: "",
};

export function emptyLabResultForm(setting: LabResultSetting = "outpatient"): LabResultFormValues {
  return {
    setting,
    specimenDate: today(),
    departmentId: "",
    departmentName: "",
    orderId: "",
    reportStatus: "final",
    originalStatus: "",
    conclusion: "",
    performer: { ...emptyLabResultPerformer },
    lines: [{ ...emptyLabResultLine }],
  };
}

// コード型(CD/CO)の選択肢。「1：陽性、2：陰性」のような文字列をパースする。
export interface CodeValueOption {
  code: string;
  display: string;
}

export function parseCodeValueList(list: string | null | undefined): CodeValueOption[] {
  if (!list) return [];
  return list
    .split(/[、,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      const [code, ...rest] = s.split(/[：:]/);
      if (!code.trim()) return [];
      return [{ code: code.trim(), display: rest.join("：").trim() || code.trim() }];
    });
}

// データタイプに応じた Observation.value[x]。
// PQ: valueQuantity / CD・CO: valueCodeableConcept / ST(その他): valueString
function buildObservationValue(line: LabResultLineValues): Partial<fhir4.Observation> {
  const item = line.item;
  const dataType = item?.data_type ?? "ST";

  if (dataType === "PQ") {
    return {
      valueQuantity: {
        value: Number(line.value),
        unit: item?.display_unit ?? undefined,
        ...(item?.ucum_unit
          ? { system: UNITS_OF_MEASURE_SYSTEM, code: item.ucum_unit }
          : {}),
      },
    };
  }

  if (dataType === "CD" || dataType === "CO") {
    const option = parseCodeValueList(item?.code_value_list).find((o) => o.code === line.value);
    if (option) {
      return {
        valueCodeableConcept: {
          coding: [
            {
              system: item?.value_code_system || undefined,
              code: option.code,
              display: option.display,
            },
          ],
          text: option.display,
        },
      };
    }
    // 選択肢が復元できない場合(マスタから消えた項目の編集など)は文字列として保持する。
    return { valueCodeableConcept: { text: line.value } };
  }

  return { valueString: line.value };
}

// 1回の検査結果の中で使われる材料(検体)ごとに1つの Specimen を参照する計画。
// 血清と血漿が混在する場合は Specimen も2つになり、各 Observation は自分の材料を参照する。
//
// オーダーに紐付く結果では、ラベル発行が作った管の Specimen(labelSpecimens)を
// そのまま参照する(referenceOnly)。実際に採った検体は管として 1 つしか無いのに、
// 結果側にもう 1 つ Specimen を作ると同じ検体が二重になるため。ラベルの無い材料
// (発行前に結果が来た・オーダー未紐付け)は結果側で作って所有する。
interface SpecimenPlan {
  code: string;
  display: string;
  fullUrl: string;
  id?: string;
  /** ラベル由来の Specimen を参照するだけ(結果側では作成・更新・削除しない)。 */
  referenceOnly?: boolean;
}

function planSpecimens(
  values: LabResultFormValues,
  originalSpecimens: SpecimenRef[],
  labelSpecimens: fhir4.Specimen[],
): Map<string, SpecimenPlan> {
  const idByCode = new Map(originalSpecimens.map((s) => [s.code, s.id]));
  const plans = new Map<string, SpecimenPlan>();

  for (const line of values.lines) {
    const code = specimenCodeOf(line.item);
    if (!code || plans.has(code)) continue;

    const label = labelSpecimens.find(
      (s) => codingBySystem(s.type?.coding, JLAC11_SPECIMEN_SYSTEM)?.code === code,
    );
    if (label?.id) {
      plans.set(code, {
        code,
        display: line.item?.specimen_name ?? "",
        fullUrl: `Specimen/${label.id}`,
        id: label.id,
        referenceOnly: true,
      });
      continue;
    }

    const id = idByCode.get(code);
    plans.set(code, {
      code,
      display: line.item?.specimen_name ?? "",
      id,
      fullUrl: id ? `Specimen/${id}` : `urn:uuid:${crypto.randomUUID()}`,
    });
  }
  return plans;
}

function buildSpecimen(plan: SpecimenPlan, patientId: string, collected: string): fhir4.Specimen {
  const resource: fhir4.Specimen = {
    resourceType: "Specimen",
    meta: { profile: [SPECIMEN_PROFILE] },
    status: "available",
    type: {
      coding: [
        {
          system: JLAC11_SPECIMEN_SYSTEM,
          code: plan.code,
          display: plan.display || undefined,
        },
      ],
      text: plan.display || undefined,
    },
    subject: { reference: `Patient/${patientId}` },
    collection: { collectedDateTime: collected },
  };

  if (plan.id) resource.id = plan.id;
  return resource;
}

// Observation.code の coding。施設の結果項目コードを先頭に、標準コード(JLAC11 / JLAC10)を
// 持っていれば併記し、最後に略称の補助 coding を添える。施設コードを持たない骨格
// (結果項目マスタ導入前の保存済み結果をそのまま保存し直したもの)は JLAC11 から始まる。
function buildCodeCodings(item: LabResultItem): fhir4.Coding[] {
  const codings: fhir4.Coding[] = [];
  if (item.result_item_code) {
    codings.push({ system: RESULT_ITEM_SYSTEM, code: item.result_item_code, display: item.name });
  }
  if (item.jlac11_code) {
    codings.push({ system: JLAC11_SYSTEM, code: item.jlac11_code, display: item.name });
  }
  if (item.jlac10_code) {
    codings.push({ system: JLAC10_SYSTEM, code: item.jlac10_code, display: item.name });
  }
  if (item.short_name) {
    codings.push({
      system: ABBREVIATION_SYSTEM,
      code: item.result_item_code || item.jlac11_code || item.name,
      display: item.short_name,
    });
  }
  return codings;
}

// 適用した基準値を Observation.referenceRange に写す(数値型のみ)。単位は結果値と同じ。
function buildReferenceRange(
  item: LabResultItem,
  range: LabReferenceRange,
): fhir4.ObservationReferenceRange {
  const quantity = (value: string): fhir4.Quantity => ({
    value: Number(value),
    unit: item.display_unit ?? undefined,
    ...(item.ucum_unit ? { system: UNITS_OF_MEASURE_SYSTEM, code: item.ucum_unit } : {}),
  });
  return {
    ...(range.lower_limit != null ? { low: quantity(range.lower_limit) } : {}),
    ...(range.upper_limit != null ? { high: quantity(range.upper_limit) } : {}),
    type: {
      coding: [{ system: REFERENCE_RANGE_MEANING_SYSTEM, code: "normal", display: "Normal Range" }],
    },
    text: referenceRangeLabel(range.lower_limit, range.upper_limit),
  };
}

function buildObservation(
  line: LabResultLineValues,
  patientId: string,
  effective: string,
  status: LabReportStatus,
  specimenReference?: string,
  range?: LabReferenceRange,
): fhir4.Observation {
  const item = line.item;
  // 未選択(空)は "N"(Normal) として記録する。
  const interpretationCode = line.interpretation || "N";

  const resource: fhir4.Observation = {
    resourceType: "Observation",
    meta: { profile: [OBSERVATION_PROFILE] },
    // 報告区分はレポートと項目で揃える(項目だけ中間・レポートだけ確定にはしない)。
    status,
    category: [
      {
        coding: [
          { system: OBSERVATION_CATEGORY_SYSTEM, code: "laboratory", display: "Laboratory" },
        ],
      },
    ],
    code: {
      coding: item ? buildCodeCodings(item) : undefined,
      text: item?.name ?? undefined,
    },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: effective,
    ...buildObservationValue(line),
    interpretation: [
      {
        coding: [
          {
            system: INTERPRETATION_SYSTEM,
            code: interpretationCode,
            display: INTERPRETATION_DISPLAYS[interpretationCode],
          },
        ],
      },
    ],
  };

  if (specimenReference) resource.specimen = { reference: specimenReference };
  if (item && range && item.data_type === "PQ") {
    resource.referenceRange = [buildReferenceRange(item, range)];
  }
  // 測定法(試薬・機器)。JLAC11 の測定法コード 3 桁は単独では引ける表が無いので、
  // 結果項目マスタが持つ名称を text として残す。
  if (item?.method_name) resource.method = { text: item.method_name };
  if (line.note.trim()) resource.note = [{ text: line.note.trim() }];
  if (line.id) resource.id = line.id;
  return resource;
}

/**
 * パニック値(緊急異常値)の通知。値がパニック値のときは未確認の Task を作り(既にあれば
 * 内容を更新して未確認に戻し)、値が直ったら取り下げる。宛先はオーダーの依頼医。
 */
function panicTaskEntries(
  values: LabResultFormValues,
  patientId: string,
  reportReference: string,
  owner?: fhir4.Reference,
  existingPanicTask?: fhir4.Task,
): fhir4.BundleEntry[] {
  if (!hasPanicValue(values)) {
    // パニック値でなくなった通知だけ取り下げる(元から無ければ何もしない)。
    return existingPanicTask?.id && existingPanicTask.status !== "cancelled"
      ? [
          {
            resource: buildCancelledNotificationTask(existingPanicTask),
            request: { method: "PUT", url: `Task/${existingPanicTask.id}` },
          },
        ]
      : [];
  }

  const task = buildPanicTask(
    {
      reportReference,
      patientId,
      owner,
      items: panicItemsOf(values),
      summary: panicSummaryOf(values),
      specimenDate: values.specimenDate,
    },
    existingPanicTask,
  );
  return [
    {
      resource: task,
      request: existingPanicTask?.id
        ? { method: "PUT", url: `Task/${existingPanicTask.id}` }
        : { method: "POST", url: "Task" },
    },
  ];
}

function buildLabResultTransactionBundle(
  values: LabResultFormValues,
  patientId: string,
  labelSpecimens: fhir4.Specimen[],
  subject?: LabResultSubject,
  panic?: LabPanicContext,
  reportId?: string,
  originalObservationIds?: string[],
  originalSpecimens?: SpecimenRef[],
): fhir4.Bundle {
  // FHIR の dateTime は日付のみ(YYYY-MM-DD)を許容し、fhir-server もそのまま受理する。
  const effective = values.specimenDate;
  // 保存するたびに決まる報告区分と報告日時。訂正のたびに「いつ出し直したか」が残る。
  const status = nextLabReportStatus(values);
  const issued = new Date().toISOString();
  const performers = buildPerformerReferences(values.performer);
  const reportReference = reportId
    ? `DiagnosticReport/${reportId}`
    : `urn:uuid:${crypto.randomUUID()}`;

  const specimenPlans = planSpecimens(values, originalSpecimens ?? [], labelSpecimens);
  // referenceOnly(ラベル由来)は参照するだけ。PUT すると発行・到着の情報
  // (番号・request・receivedTime)を消してしまう。
  const specimenEntries: fhir4.BundleEntry[] = Array.from(specimenPlans.values())
    .filter((plan) => !plan.referenceOnly)
    .map((plan) => ({
      fullUrl: plan.fullUrl,
      resource: buildSpecimen(plan, patientId, effective),
      request: plan.id
        ? { method: "PUT" as const, url: `Specimen/${plan.id}` }
        : { method: "POST" as const, url: "Specimen" },
    }));
  const specimenReferences: fhir4.Reference[] = Array.from(specimenPlans.values()).map((plan) => ({
    reference: plan.fullUrl,
    display: plan.display || undefined,
  }));

  const observationEntries: fhir4.BundleEntry[] = [];
  const resultReferences: fhir4.Reference[] = [];
  const keptObservationIds = new Set<string>();

  for (const line of values.lines) {
    const specimenReference = specimenPlans.get(specimenCodeOf(line.item))?.fullUrl;
    const range = matchReferenceRange(line.item, subject, values.specimenDate);
    const resource = buildObservation(line, patientId, effective, status, specimenReference, range);
    const fullUrl = line.id ? `Observation/${line.id}` : `urn:uuid:${crypto.randomUUID()}`;
    if (line.id) keptObservationIds.add(line.id);

    observationEntries.push({
      fullUrl,
      resource,
      request: line.id
        ? { method: "PUT", url: `Observation/${line.id}` }
        : { method: "POST", url: "Observation" },
    });
    resultReferences.push({
      reference: fullUrl,
      display: line.item?.short_name ?? line.item?.name ?? undefined,
    });
  }

  const report: fhir4.DiagnosticReport = {
    resourceType: "DiagnosticReport",
    meta: { profile: [REPORT_PROFILE] },
    status,
    category: [
      { coding: [{ system: REPORT_CATEGORY_SYSTEM, code: "LAB", display: "Laboratory" }] },
      {
        coding: [
          { system: SETTING_SYSTEM, code: values.setting, display: findSettingDisplay(values.setting) },
        ],
      },
    ],
    code: {
      coding: [{ system: LOINC_SYSTEM, code: LOINC_LAB_REPORT_CODE, display: "Laboratory report" }],
      text: "臨床検査結果",
    },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: effective,
    // 報告日時。採取日(effective)しか無いと、いつ報告されたか・いつ訂正したかが残らない。
    issued,
    // 実施施設(自院)と実施者(登録したログインユーザー)。
    performer: performers.length ? performers : undefined,
    conclusion: values.conclusion.trim() || undefined,
    // 診療科。DiagnosticReport にも診療科を持つ標準要素が無いため、オーダーの
    // 依頼科と同じローカル拡張で持たせる。
    extension: values.departmentId
      ? [departmentExtension(values.departmentId, values.departmentName)]
      : undefined,
    // 元になった検体検査オーダー。オーダーの明細ではなくヘッダを指す。
    // 更新でオーダーの選択を外した場合は、リソースごと組み直すので basedOn も消える。
    basedOn: values.orderId ? [{ reference: `ServiceRequest/${values.orderId}` }] : undefined,
    specimen: specimenReferences.length ? specimenReferences : undefined,
    result: resultReferences,
  };

  if (reportId) report.id = reportId;

  const removedObservationEntries: fhir4.BundleEntry[] = (originalObservationIds ?? [])
    .filter((id) => !keptObservationIds.has(id))
    .map((id) => ({ request: { method: "DELETE", url: `Observation/${id}` } }));

  // 使われなくなった材料の Specimen を消す(originalSpecimens は結果側が所有する
  // ものだけが渡る。specimenRefsFrom を参照)。ラベル由来の参照に置き換わった材料の
  // 旧 Specimen も、もう参照されないので消す。Observation より後に置くことで、
  // 参照元の Observation が先に更新/削除されてから検体が消える順序になる。
  const removedSpecimenEntries: fhir4.BundleEntry[] = (originalSpecimens ?? [])
    .filter((s) => {
      const plan = specimenPlans.get(s.code);
      return !plan || plan.referenceOnly;
    })
    .map((s) => ({ request: { method: "DELETE", url: `Specimen/${s.id}` } }));

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        fullUrl: reportReference,
        resource: report,
        request: reportId
          ? { method: "PUT", url: `DiagnosticReport/${reportId}` }
          : { method: "POST", url: "DiagnosticReport" },
      },
      ...specimenEntries,
      ...observationEntries,
      ...removedObservationEntries,
      ...removedSpecimenEntries,
      ...panicTaskEntries(values, patientId, reportReference, panic?.owner, panic?.existingTask),
    ],
  };
}

/** パニック値の通知に要る文脈。宛先(依頼医)と、更新時の既存の通知。 */
export interface LabPanicContext {
  owner?: fhir4.Reference;
  existingTask?: fhir4.Task;
}

export function buildLabResultBundle(
  values: LabResultFormValues,
  patientId: string,
  labelSpecimens: fhir4.Specimen[] = [],
  subject?: LabResultSubject,
  panic?: LabPanicContext,
): fhir4.Bundle {
  return buildLabResultTransactionBundle(values, patientId, labelSpecimens, subject, panic);
}

export function buildLabResultUpdateBundle(
  values: LabResultFormValues,
  patientId: string,
  reportId: string,
  originalObservationIds: string[],
  originalSpecimens: SpecimenRef[],
  labelSpecimens: fhir4.Specimen[] = [],
  subject?: LabResultSubject,
  panic?: LabPanicContext,
): fhir4.Bundle {
  return buildLabResultTransactionBundle(
    values,
    patientId,
    labelSpecimens,
    subject,
    panic,
    reportId,
    originalObservationIds,
    originalSpecimens,
  );
}

export function buildLabResultDeleteBundle(
  reportId: string,
  observationIds: string[],
  specimenIds: string[],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      { request: { method: "DELETE", url: `DiagnosticReport/${reportId}` } },
      ...observationIds.map((id) => ({
        request: { method: "DELETE" as const, url: `Observation/${id}` },
      })),
      // 参照元の Observation を消してから検体を消す。
      ...specimenIds.map((id) => ({
        request: { method: "DELETE" as const, url: `Specimen/${id}` },
      })),
    ],
  };
}

function referencedIds(references: fhir4.Reference[] | undefined): string[] {
  return (references ?? [])
    .map((r) => r.reference?.split("/").pop())
    .filter((id): id is string => Boolean(id));
}

export function observationIdsFromReport(report: fhir4.DiagnosticReport): string[] {
  return referencedIds(report.result);
}

export function specimenIdsFromReport(report: fhir4.DiagnosticReport): string[] {
  return referencedIds(report.specimen);
}

// ---- 一覧・詳細表示のための parse ----

export interface LabResultSummary {
  id: string;
  date: string;
  settingDisplay: string;
  /** 検査を行った診療科の表示名。空なら未設定。 */
  departmentName: string;
  itemCount: number;
  /** 元になった検体検査オーダーの id。空なら紐付けなし。 */
  orderId: string;
}

/** DiagnosticReport.basedOn が指す検体検査オーダー(ヘッダ)の id。無ければ空。 */
export function labOrderIdFromReport(
  report: fhir4.DiagnosticReport | undefined,
): string {
  const reference = report?.basedOn?.find((r) =>
    r.reference?.startsWith("ServiceRequest/"),
  )?.reference;
  return reference?.split("/")[1] ?? "";
}

// Observation.interpretation から H/L/N コードを取り出す。未記録なら空文字。
function interpretationCodeOf(obs: fhir4.Observation): string {
  for (const concept of obs.interpretation ?? []) {
    const coding = codingBySystem(concept.coding, INTERPRETATION_SYSTEM);
    if (coding?.code) return coding.code;
  }
  return "";
}

// HH/H/L/LL のみ表示・フォームの対象にする。"N"(および未記録)は通常表示として扱う。
function formInterpretationOf(obs: fhir4.Observation): LabInterpretation {
  const code = interpretationCodeOf(obs);
  return INTERPRETATION_OPTIONS.includes(code as Exclude<LabInterpretation, "">)
    ? (code as LabInterpretation)
    : "";
}

// 判定に応じた表示用クラス修飾子を返す。H: 赤字 / L: 青字 / HH・LL(パニック値): 反転して目立たせる。
export function interpretationClass(
  interpretation: string,
  base: string,
): string {
  if (interpretation === "HH") return `${base} ${base}--critical-high`;
  if (interpretation === "LL") return `${base} ${base}--critical-low`;
  if (interpretation === "H") return `${base} ${base}--high`;
  if (interpretation === "L") return `${base} ${base}--low`;
  return base;
}

export function summarizeDiagnosticReport(report: fhir4.DiagnosticReport): LabResultSummary {
  return {
    id: report.id ?? "",
    date: report.effectiveDateTime?.slice(0, 10) ?? "",
    settingDisplay: categoryCoding(report, SETTING_SYSTEM)?.display ?? "",
    departmentName: departmentOf(report).departmentName,
    itemCount: report.result?.length ?? 0,
    orderId: labOrderIdFromReport(report),
  };
}

/** 内容表示の「検査共通」に出すレポートの情報(報告区分・報告日時・実施者・総合所見)。 */
export interface LabReportInfo {
  status: string;
  statusDisplay: string;
  /** 報告日時("YYYY-MM-DD HH:mm")。未記録なら空。 */
  issued: string;
  conclusion: string;
  performer: LabResultPerformer;
}

export function labReportInfo(report: fhir4.DiagnosticReport): LabReportInfo {
  return {
    status: report.status ?? "",
    statusDisplay: labReportStatusDisplay(report.status),
    // instant(タイムゾーン付き)なので、表示は実行環境のローカル時刻に直す。
    issued: report.issued ? labInstantLabel(report.issued) : "",
    conclusion: report.conclusion ?? "",
    performer: parsePerformer(report),
  };
}

// instant("2026-09-10T05:00:00.000Z")→ "2026-09-10 14:00"(ローカル時刻)。
// 読めない値はそのまま返す。報告日時と版履歴の更新日時で使う。
export function labInstantLabel(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export interface LabResultDetailBundle {
  report?: fhir4.DiagnosticReport;
  observations: fhir4.Observation[];
  specimens: fhir4.Specimen[];
}

export function splitLabResultDetailBundle(bundle: fhir4.Bundle): LabResultDetailBundle {
  const result: LabResultDetailBundle = { observations: [], specimens: [] };
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "DiagnosticReport") {
      result.report = resource as fhir4.DiagnosticReport;
    } else if (resource?.resourceType === "Observation") {
      result.observations.push(resource as fhir4.Observation);
    } else if (resource?.resourceType === "Specimen") {
      result.specimens.push(resource as fhir4.Specimen);
    }
  }

  // include で返る Observation の順序は不定のため、DiagnosticReport.result の
  // 参照順(=登録時の並び)に揃える。
  if (result.report) {
    const order = new Map(
      observationIdsFromReport(result.report).map((id, index) => [id, index]),
    );
    result.observations.sort(
      (a, b) => (order.get(a.id ?? "") ?? Infinity) - (order.get(b.id ?? "") ?? Infinity),
    );
  }
  return result;
}

export interface LabResultLineDisplay {
  id: string;
  name: string;
  abbreviation: string;
  specimen: string;
  value: string;
  unit: string;
  // 保存時に適用した基準値(「6.6〜8.1」)。無ければ空。
  referenceRange: string;
  // H/L 判定("H" | "L" | "")。表示の色分けに使う。
  interpretation: LabInterpretation;
  // 測定法(試薬・機器)。列を増やさないよう、項目名のツールチップに添える。
  method: string;
  // 項目ごとのコメント。あれば項目の下に 1 行で出す。
  note: string;
}

function specimenName(specimen: fhir4.Specimen): string {
  return (
    specimen.type?.text ??
    codingBySystem(specimen.type?.coding, JLAC11_SPECIMEN_SYSTEM)?.display ??
    ""
  );
}

// Observation.specimen の参照先を引くための、Specimen id → 材料名称の対応。
export function specimenNamesById(specimens: fhir4.Specimen[]): Map<string, string> {
  return new Map(
    specimens.flatMap((s) => (s.id ? [[s.id, specimenName(s)] as [string, string]] : [])),
  );
}

// Observation.value[x] の表示値と単位。PQ 以外に単位はない。
function observationValueDisplay(obs: fhir4.Observation): { value: string; unit: string } {
  if (obs.valueQuantity) {
    return {
      value: obs.valueQuantity.value != null ? String(obs.valueQuantity.value) : "",
      unit: obs.valueQuantity.unit ?? "",
    };
  }
  if (obs.valueCodeableConcept) {
    return {
      value: obs.valueCodeableConcept.coding?.[0]?.display ?? obs.valueCodeableConcept.text ?? "",
      unit: "",
    };
  }
  return { value: obs.valueString ?? "", unit: "" };
}

// Observation の項目名。施設コードの coding → JLAC11 の coding → text の順に読む。
function observationItemName(obs: fhir4.Observation): string {
  return (
    codingBySystem(obs.code.coding, RESULT_ITEM_SYSTEM)?.display ??
    codingBySystem(obs.code.coding, JLAC11_SYSTEM)?.display ??
    obs.code.text ??
    ""
  );
}

export function observationLineDisplay(
  obs: fhir4.Observation,
  specimenNames?: Map<string, string>,
): LabResultLineDisplay {
  const abbrCoding = codingBySystem(obs.code.coding, ABBREVIATION_SYSTEM);
  const specimenId = obs.specimen?.reference?.split("/").pop();
  const { value, unit } = observationValueDisplay(obs);

  return {
    id: obs.id ?? "",
    name: observationItemName(obs),
    abbreviation: abbrCoding?.display ?? "",
    specimen: (specimenId && specimenNames?.get(specimenId)) || "",
    value,
    unit,
    referenceRange: observationReferenceRangeLabel(obs),
    interpretation: formInterpretationOf(obs),
    method: obs.method?.text ?? obs.method?.coding?.[0]?.display ?? "",
    note: (obs.note ?? []).map((note) => note.text).filter(Boolean).join(" / "),
  };
}

// ---- 時系列表示のための parse ----

export interface LabTimelineRow {
  // 同じ結果項目の結果を1行にまとめるためのキー(labTimelineKeyOf)。
  key: string;
  name: string;
  abbreviation: string;
  unit: string;
  // 基準値。並びが先(=新しい結果)のものを採る(年齢帯で変わるため最新を出す)。
  referenceRange: string;
  // 検体採取日(YYYY-MM-DD) → 表示値
  values: Map<string, string>;
  // 検体採取日 → 数値。PQ(valueQuantity) のみ。グラフ描画に使う。
  numbers: Map<string, number>;
  // 検体採取日 → H/L 判定。H は赤字、L は青字で表示する。N は登録しない。
  interpretations: Map<string, LabInterpretation>;
  // 検体採取日 → 報告区分。中間報告・訂正報告のセルに印を出すために持つ
  // (最終報告は印を出さないので登録しない)。
  statuses: Map<string, string>;
}

export interface LabTimeline {
  // 表示対象の検体採取日。古い順。
  dates: string[];
  rows: LabTimelineRow[];
}

// Observation の結果項目コード(施設コード)。結果項目マスタ導入前の保存済み結果には無い。
export function labResultItemCodeOf(obs: fhir4.Observation): string {
  return codingBySystem(obs.code.coding, RESULT_ITEM_SYSTEM)?.code ?? "";
}

// Observation の JLAC11 コード。感染症・腎機能の判定(分析物コード)と、結果項目マスタ導入前の
// 保存済み結果から結果項目を引き当てるのに使う。
export function labJlac11CodeOf(obs: fhir4.Observation): string {
  return codingBySystem(obs.code.coding, JLAC11_SYSTEM)?.code ?? "";
}

// 施設コードを持たない Observation(結果項目マスタ導入前の保存済み結果)の JLAC11 コード。
// これで結果項目マスタを引き、施設コードの行と同じ結果項目に合流させる(resultItemAliases)。
export function legacyJlac11CodesOf(observations: fhir4.Observation[]): string[] {
  const codes = observations.flatMap((obs) =>
    labResultItemCodeOf(obs) ? [] : [labJlac11CodeOf(obs)].filter(Boolean),
  );
  return [...new Set(codes)];
}

// JLAC11 の読み替えキー。17 桁のうち測定物 5 + 識別 4 + 材料 3 の 12 桁で、残りの
// 測定法 3 + 結果単位 2 は試薬・機器で変わるため同じ結果項目と見なす(docs/lab-order-master-design.md §3)。
// 結果項目マスタ導入前の保存済み結果は試薬単位の 17 桁を持ち、マスタの代表コードとは
// 下 5 桁が違うことが多いので、この単位で引き当てる。17 桁でないコードは読み替えない。
const JLAC11_LENGTH = 17;
const JLAC11_ALIAS_LENGTH = 12;

export function jlac11AliasKey(code: string): string {
  return code.length === JLAC11_LENGTH ? code.slice(0, JLAC11_ALIAS_LENGTH) : "";
}

// JLAC11 の読み替えキー → 結果項目コード。結果項目マスタ導入前の保存済み結果を、同じ
// 測定物・識別・材料の結果項目に読み替えるための対応。複数の結果項目が同じキーを持つ
// (定量と定性など)ことがあるので、マスタの並び(表示順)で先に来たものを採る。
export function resultItemAliases(items: LabResultItem[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const item of items) {
    const key = item.jlac11_code ? jlac11AliasKey(item.jlac11_code) : "";
    if (key && !aliases.has(key)) aliases.set(key, item.result_item_code);
  }
  return aliases;
}

// aliases(resultItemAliases)で JLAC11 を結果項目コードに読み替える。読み替えられなければ空。
function aliasOf(jlac11: string, aliases: ReadonlyMap<string, string> | undefined): string {
  const key = jlac11AliasKey(jlac11);
  return (key && aliases?.get(key)) || "";
}

// 時系列表示で同じ検査項目を1行にまとめるキー(LabTimelineRow.key)。
// 検査結果内容ページの「選択項目のみ時系列表示」で行の絞り込みにも使う。
// 施設コードがあればそれ、無ければ JLAC11 を aliases(JLAC11 → 結果項目コード)で
// 読み替えて同じキーにする。読み替えられなければ JLAC11、それも無ければ名称。
export function labTimelineKeyOf(
  obs: fhir4.Observation,
  aliases?: ReadonlyMap<string, string>,
): string {
  const resultItemCode = labResultItemCodeOf(obs);
  if (resultItemCode) return `item:${resultItemCode}`;
  const jlac11 = labJlac11CodeOf(obs);
  if (jlac11) {
    const alias = aliasOf(jlac11, aliases);
    return alias ? `item:${alias}` : `jlac11:${jlac11}`;
  }
  return `name:${observationItemName(obs)}`;
}

// DiagnosticReport(検体採取日の降順) と _include で取得した Observation から、
// 「検査項目 × 検体採取日」のマトリクスを組み立てる。
// 日付は新しい方から dateCount 件を対象にし、列は古い順(旧→新)で返す。
// 行の並びは新しいレポートでの登場順(= 登録時の項目順)になる。
export function buildLabTimeline(
  reports: fhir4.DiagnosticReport[],
  observations: fhir4.Observation[],
  dateCount: number,
  aliases?: ReadonlyMap<string, string>,
): LabTimeline {
  const obsById = new Map(observations.map((obs) => [obs.id ?? "", obs]));

  const dates: string[] = [];
  for (const report of reports) {
    const date = report.effectiveDateTime?.slice(0, 10);
    if (date && !dates.includes(date)) dates.push(date);
  }
  // 新しい方から dateCount 件を選んだうえで、表示用に古い順へ並べ替える。
  const shownDates = dates.slice(0, dateCount).reverse();
  const shown = new Set(shownDates);

  const rows = new Map<string, LabTimelineRow>();
  for (const report of reports) {
    const date = report.effectiveDateTime?.slice(0, 10) ?? "";
    if (!shown.has(date)) continue;
    for (const obsId of observationIdsFromReport(report)) {
      const obs = obsById.get(obsId);
      if (!obs) continue;

      const key = labTimelineKeyOf(obs, aliases);
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          name: observationItemName(obs),
          abbreviation: codingBySystem(obs.code.coding, ABBREVIATION_SYSTEM)?.display ?? "",
          unit: "",
          referenceRange: "",
          values: new Map(),
          numbers: new Map(),
          interpretations: new Map(),
          statuses: new Map(),
        };
        rows.set(key, row);
      }

      const { value, unit } = observationValueDisplay(obs);
      if (!row.unit && unit) row.unit = unit;
      if (!row.referenceRange) row.referenceRange = observationReferenceRangeLabel(obs);
      // 同じ日に同じ項目が複数ある場合(同日の別レポートなど)は、
      // 並びが先(=新しいレポート)の値を採用する。
      if (row.values.has(date)) continue;
      row.values.set(date, value);
      if (obs.valueQuantity?.value != null) row.numbers.set(date, obs.valueQuantity.value);
      const interpretation = formInterpretationOf(obs);
      if (interpretation) row.interpretations.set(date, interpretation);
      const status = obs.status ?? "";
      if (isPreliminaryReport(status) || isCorrectedReport(status)) row.statuses.set(date, status);
    }
  }

  return { dates: shownDates, rows: [...rows.values()] };
}

// ---- 編集フォームへの復元 ----
//
// FHIR リソースにはマスタの全項目(コード型の選択肢など)は保存されていないため、
// まず保存済みの値のみを持つ簡易オブジェクトとして復元し、編集画面側で
// hydrateLabResultForm によりマスタ情報を引き直して補完する。

// 施設コードか JLAC11 のどちらも無い Observation は復元できない(null)。
function resultItemFromObservation(
  obs: fhir4.Observation,
  specimenNames: Map<string, string>,
): LabResultItem | null {
  const resultItemCoding = codingBySystem(obs.code.coding, RESULT_ITEM_SYSTEM);
  const jlac11Coding = codingBySystem(obs.code.coding, JLAC11_SYSTEM);
  if (!resultItemCoding?.code && !jlac11Coding?.code) return null;
  const abbrCoding = codingBySystem(obs.code.coding, ABBREVIATION_SYSTEM);
  const specimenId = obs.specimen?.reference?.split("/").pop();
  const specimen = specimenId ? specimenNames.get(specimenId) : undefined;

  const dataType = obs.valueQuantity ? "PQ" : obs.valueCodeableConcept ? "CD" : "ST";

  return {
    id: 0,
    result_item_code: resultItemCoding?.code ?? "",
    name: observationItemName(obs),
    short_name: abbrCoding?.display ?? null,
    name_kana: null,
    category: null,
    // 材料コードは Observation から読めない(Specimen 側にある)ので、材料名だけを表示用に持つ。
    specimen_code: null,
    specimen_name: specimen || null,
    data_type: dataType,
    display_unit: obs.valueQuantity?.unit ?? null,
    ucum_unit: obs.valueQuantity?.code ?? null,
    code_value_list: null,
    value_code_system: null,
    decimal_places: null,
    jlac11_code: jlac11Coding?.code ?? null,
    jlac10_code: codingBySystem(obs.code.coding, JLAC10_SYSTEM)?.code ?? null,
    loinc_code: null,
    method_name: obs.method?.text ?? null,
    valid_from: null,
    valid_to: null,
    display_order: null,
    note: null,
  };
}

function lineValueFromObservation(obs: fhir4.Observation): string {
  if (obs.valueQuantity) {
    return obs.valueQuantity.value != null ? String(obs.valueQuantity.value) : "";
  }
  if (obs.valueCodeableConcept) {
    return obs.valueCodeableConcept.coding?.[0]?.code ?? obs.valueCodeableConcept.text ?? "";
  }
  return obs.valueString ?? "";
}

export function parseLabResultForm(
  report: fhir4.DiagnosticReport,
  observations: fhir4.Observation[],
  specimens: fhir4.Specimen[] = [],
): LabResultFormValues {
  const specimenNames = specimenNamesById(specimens);
  const lines: LabResultLineValues[] = observations.map((obs) => ({
    id: obs.id,
    item: resultItemFromObservation(obs, specimenNames),
    value: lineValueFromObservation(obs),
    interpretation: formInterpretationOf(obs),
    note: (obs.note ?? []).map((note) => note.text).filter(Boolean).join(" / "),
  }));

  return {
    setting: (categoryCoding(report, SETTING_SYSTEM)?.code ?? "") as LabResultSetting,
    specimenDate: report.effectiveDateTime?.slice(0, 10) ?? today(),
    ...departmentOf(report),
    orderId: labOrderIdFromReport(report),
    // 訂正済みの結果を開き直したときも、選択肢は中間・最終の 2 つに落とす
    // (訂正のままか最終へ戻すかは originalStatus が決める)。
    reportStatus: isPreliminaryReport(report.status) ? "preliminary" : "final",
    originalStatus: report.status ?? "",
    conclusion: report.conclusion ?? "",
    performer: parsePerformer(report),
    lines: lines.length ? lines : [{ ...emptyLabResultLine }],
  };
}

// 既存の検査結果を DO(流用)して新規登録するためのフォーム値に変換する。
// ・検査項目(と入外区分)は引き継ぐ
// ・結果値(と H/L 判定)は継承せず空にする
// ・Observation の id を落とし、既存リソースの更新ではなく新規登録にする
// ・検体採取日は DO 元ではなく当日にする
// ・検体検査オーダーの紐付けは引き継がない(DO 元のオーダーには既に結果があるため)
// ・報告区分・総合所見・項目コメント・実施者は結果そのものなので引き継がない
export function buildDoLabResultForm(
  values: LabResultFormValues,
  setting: LabResultSetting,
): LabResultFormValues {
  return {
    ...values,
    setting,
    specimenDate: today(),
    orderId: "",
    reportStatus: "final",
    originalStatus: "",
    conclusion: "",
    performer: { ...emptyLabResultPerformer },
    lines: values.lines.map((line) => ({
      item: line.item,
      value: "",
      interpretation: "",
      note: "",
    })),
  };
}

// 更新 Bundle 用に、保存済み Specimen の 材料コード → id を取り出す。
// 同じ材料が引き続き使われていればその Specimen を PUT で使い回す。
/**
 * 検査結果が参照する Specimen のうち、結果側が所有するものだけの材料コード → id。
 * ラベル由来(オーダー側所有)は更新・削除の対象にしないため除く。
 */
export function specimenRefsFrom(specimens: fhir4.Specimen[]): SpecimenRef[] {
  return specimens.flatMap((s) => {
    if (isLabelSpecimen(s)) return [];
    const code = codingBySystem(s.type?.coding, JLAC11_SPECIMEN_SYSTEM)?.code;
    return code && s.id ? [{ code, id: s.id }] : [];
  });
}

// 復元した簡易オブジェクトを、マスタから引き直した完全な LabResultItem で置き換える。
// 施設コードで引き、施設コードを持たない骨格(結果項目マスタ導入前の保存済み結果)は
// JLAC11 で引く(結果項目間で一意とは限らないので先勝ち)。マスタに存在しなくなった
// コードは簡易オブジェクトのまま残す。
export function hydrateLabResultForm(
  values: LabResultFormValues,
  masterItems: LabResultItem[],
): LabResultFormValues {
  const byCode = new Map(masterItems.map((item) => [item.result_item_code, item]));
  const aliases = resultItemAliases(masterItems);
  return {
    ...values,
    lines: values.lines.map((line) => {
      if (!line.item) return line;
      const code =
        line.item.result_item_code ||
        (line.item.jlac11_code ? aliasOf(line.item.jlac11_code, aliases) : "");
      const master = code ? byCode.get(code) : undefined;
      return master ? { ...line, item: master } : line;
    }),
  };
}
