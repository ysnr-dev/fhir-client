import { addDays, addMonths, diffDays, localDay } from "../lib/dates";
import {
  currentDpcDecision,
  DPC_CODING_QUESTIONNAIRE,
  parseDpcCodingResponse,
  type DpcCodingDecision,
} from "./dpcCodingRecord";
import { DPC_FORM1_QUESTIONNAIRE } from "./dpcForm1Helpers";
import { encounterBedId, encounterDepartmentName } from "./encounterHelpers";
import { displayName, patientNumberOf } from "./patientHelpers";
import { referenceId } from "./shared";

// DPC 患者一覧の行(pages/DpcPatientListPage.tsx)。入院ごとに様式1 の状態と、今の
// 診断群分類(有効な決定のうち最新)、在院日数と期間Ⅱの末日・超過日数を並べる。
// 入院期間の日数・点数は決定の時点で記録に写してあるので、ここではマスタを引かない。

export type DpcForm1State = "none" | "in-progress" | "completed" | "amended";

export interface DpcPatientRow {
  encounterId: string;
  patientId: string;
  patientNumber: string;
  patientName: string;
  wardName: string;
  department: string;
  admittedOn: string;
  dischargedOn: string;
  stayDays: number;
  form1: DpcForm1State;
  decision?: DpcCodingDecision;
  /** 期間Ⅱの末日(決定が無い・出来高なら空)。 */
  period2End: string;
  /** 期間Ⅱの末日を過ぎた日数(過ぎていなければ 0)。 */
  overDays: number;
  /** 期間Ⅱの末日までの残り日数(過ぎていれば負)。 */
  daysLeft: number | null;
  /**
   * 月末の再判定がまだの入院中の入院。月末が近い(MONTH_END_NOTICE_DAYS 以内)のに、
   * 基準日の月に「月末」の決定が無い。月末に発火する主体が無いので、通知にせず一覧の表示で知らせる。
   */
  monthlyDue: boolean;
}

/** 月末の再判定を促し始める、月末日までの日数(月末日を含めて 4 日間)。 */
export const MONTH_END_NOTICE_DAYS = 3;

/** 日付(YYYY-MM-DD)の月の末日。 */
function monthEndOf(date: string): string {
  return addDays(addMonths(`${date.slice(0, 7)}-01`, 1), -1);
}

export const DPC_FORM1_STATE_LABELS: Record<DpcForm1State, string> = {
  none: "未作成",
  "in-progress": "下書き",
  completed: "確定",
  amended: "修正済み",
};

export function buildDpcPatientRows({
  encounters,
  patientsById,
  responses,
  wardNameOf,
  baseDate,
}: {
  encounters: fhir4.Encounter[];
  patientsById: Map<string, fhir4.Patient>;
  responses: fhir4.QuestionnaireResponse[];
  wardNameOf: (bedId: string | undefined) => string;
  /** 入院中の在院日数を数える日(今日)。 */
  baseDate: string;
}): DpcPatientRow[] {
  const byEncounter = new Map<string, fhir4.QuestionnaireResponse[]>();
  for (const response of responses) {
    const id = referenceId(response.encounter?.reference);
    if (!id) continue;
    byEncounter.set(id, [...(byEncounter.get(id) ?? []), response]);
  }

  return encounters.map((encounter) => {
    const id = encounter.id ?? "";
    const patientId = referenceId(encounter.subject?.reference) ?? "";
    const patient = patientsById.get(patientId);
    const admittedOn = localDay(encounter.period?.start);
    const dischargedOn = encounter.status === "finished" ? localDay(encounter.period?.end) : "";
    const stayDays = admittedOn ? diffDays(admittedOn, dischargedOn || baseDate) + 1 : 0;
    const records = byEncounter.get(id) ?? [];
    const form1 = records
      .filter((r) => r.questionnaire === DPC_FORM1_QUESTIONNAIRE)
      .sort((a, b) => (b.meta?.lastUpdated ?? "").localeCompare(a.meta?.lastUpdated ?? ""))[0];
    const decisions = records
      .filter((r) => r.questionnaire === DPC_CODING_QUESTIONNAIRE)
      .map(parseDpcCodingResponse);
    const decision = currentDpcDecision(decisions);
    const monthlyDone = decisions.some(
      (d) => d.status === "completed" && d.timing === "monthly" && localDay(d.authored).slice(0, 7) === baseDate.slice(0, 7),
    );
    const monthlyDue =
      !dischargedOn && diffDays(baseDate, monthEndOf(baseDate)) <= MONTH_END_NOTICE_DAYS && !monthlyDone;
    const days2 = decision?.bundled ? (decision.days[1] ?? null) : null;
    const period2End = admittedOn && days2 ? addDays(admittedOn, days2 - 1) : "";
    return {
      encounterId: id,
      patientId,
      patientNumber: patient ? (patientNumberOf(patient) ?? "") : "",
      patientName: patient ? displayName(patient) : (encounter.subject?.display ?? ""),
      wardName: wardNameOf(encounterBedId(encounter)),
      department: encounterDepartmentName(encounter),
      admittedOn,
      dischargedOn,
      stayDays,
      form1: form1 ? (form1.status as DpcForm1State) : "none",
      decision,
      period2End,
      overDays: days2 ? Math.max(0, stayDays - days2) : 0,
      daysLeft: days2 ? days2 - stayDays : null,
      monthlyDue,
    };
  });
}
