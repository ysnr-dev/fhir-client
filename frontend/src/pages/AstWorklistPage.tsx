import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useMedicineAttributeLookup, useMedicineDoseFactors } from "../api/masterQueries";
import {
  useAntimicrobialAdministrations,
  useAntimicrobialNotifications,
  useApproveAntimicrobialNotification,
  useBedWardIndex,
  useCareTeams,
  useEncountersInRange,
  useHospitalAntimicrobialCourses,
  useInpatientEncounters,
  useOpenAntimicrobialNotifications,
  useOrderEnterer,
  useRecentPositiveBloodCultures,
  useTdmResults,
  useTeamActiveRequestPatientIds,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { QuestionnaireResponseCreatePanel } from "../components/QuestionnaireResponsePanels";
import { TeamRequestCreatePanel } from "../components/TeamRequestPanels";
import { TruncatedNotice } from "../components/TruncatedNotice";
import {
  ANTIMICROBIAL_CATEGORY_LABEL,
  antimicrobialCategoryOf,
  courseDayNumber,
  LONG_COURSE_DAYS,
  VERY_LONG_COURSE_DAYS,
  type AntimicrobialCourse,
} from "../fhir/antimicrobialHelpers";
import {
  ANTIMICROBIAL_NOTIFICATION_STATE_LABEL,
  antimicrobialNotificationRowOf,
  antimicrobialNotifiedEntries,
  AST_NOTIFY_QUESTIONNAIRE_URL,
  type AntimicrobialNotificationRow,
} from "../fhir/antimicrobialNotificationHelpers";
import { summarizeAntimicrobialUsage } from "../fhir/antimicrobialUsageHelpers";
import { patientsByDayAtBeds } from "../fhir/bedScheduleHelpers";
import { isCareTeamMember } from "../fhir/careTeamHelpers";
import { convertDose } from "../fhir/doseConversionHelpers";
import { encounterBedId, encounterPatientId } from "../fhir/encounterHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { csvBlob } from "../lib/csv";
import { addDays, addMonths, today } from "../lib/dates";
import { downloadBlob } from "../lib/download";
import { useReturnLinkState } from "../returnTo";

// 抗菌薬適正使用支援(AST)の一覧。設計は docs/antimicrobial-stewardship-design.md §2.3・§3。
//
// - 使用中   … 入院中で、特定抗菌薬(届出制・許可制)を投与している患者
// - 長期投与 … 入院中で、同じ成分の抗菌薬を 7 日以上続けている患者
// - 血液培養 … 採取日が直近 14 日の血液培養の陽性
// - 届出     … 未対応の届出の通知(届出未提出・許可待ち)。届出書の記入と許可をここで行う
// - 集計     … 月 × 病棟の AUD・DOT

type Tab = "usage" | "long" | "blood" | "notify" | "summary";

const TABS: { key: Tab; label: string }[] = [
  { key: "usage", label: "使用中" },
  { key: "long", label: "長期投与" },
  { key: "blood", label: "血液培養" },
  { key: "notify", label: "届出" },
  { key: "summary", label: "集計" },
];

type Dialog =
  | { kind: "team-request"; patientId: string; name: string }
  | { kind: "notify"; row: AntimicrobialNotificationRow; name: string };

interface PatientPlace {
  patient?: fhir4.Patient;
  wardName: string;
}

export function AstWorklistPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === searchParams.get("tab"))?.key ?? "usage") as Tab;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const todayValue = today();

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const inpatients = useInpatientEncounters(todayValue);
  const bedWards = useBedWardIndex();
  const teams = useCareTeams({ kind: "ast" });
  const astTeam = teams.data?.[0];
  const { practitionerId } = useCurrentPractitioner();
  const isAstMember = Boolean(astTeam && isCareTeamMember(astTeam, practitionerId));
  const intervening = useTeamActiveRequestPatientIds(astTeam?.id);

  // 入院中の患者 → 患者と病棟。
  const places = useMemo(() => {
    const map = new Map<string, PatientPlace>();
    for (const encounter of inpatients.data?.encounters ?? []) {
      if (encounter.status !== "in-progress") continue;
      const patientId = encounterPatientId(encounter);
      if (!patientId) continue;
      const bedId = encounterBedId(encounter);
      map.set(patientId, {
        patient: inpatients.data?.patientsById.get(patientId),
        wardName: (bedId && bedWards.bedWards.get(bedId)?.wardName) || "",
      });
    }
    return map;
  }, [inpatients.data, bedWards.bedWards]);

  const rowActions = (patientId: string, name: string) => ({
    teamRequest:
      astTeam && !intervening.data?.has(patientId)
        ? () => setDialog({ kind: "team-request", patientId, name })
        : undefined,
    intervening: Boolean(intervening.data?.has(patientId)),
  });

  return (
    <div className="page">
      <div className="page__header">
        <h1>抗菌薬適正使用</h1>
      </div>

      <div className="order-select__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => setSearchParams({ tab: t.key })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ErrorBanner error={inpatients.error} />
      <ErrorBanner error={teams.error} />
      {!teams.isPending && !astTeam && (tab === "usage" || tab === "long" || tab === "blood") && (
        <p className="order-select__muted">区分「抗菌薬適正使用(AST)」のチームが無いため、チーム依頼は出せません。</p>
      )}

      {(tab === "usage" || tab === "long") && (
        <CourseTab mode={tab} today={todayValue} places={places} rowActions={rowActions} />
      )}
      {tab === "blood" && <BloodCultureTab today={todayValue} places={places} rowActions={rowActions} />}
      {tab === "notify" && (
        <NotifyTab
          isAstMember={isAstMember}
          onNotify={(row, name) => setDialog({ kind: "notify", row, name })}
        />
      )}
      {tab === "summary" && <SummaryTab />}

      {dialog?.kind === "team-request" && astTeam?.id && (
        <Modal title={`チーム依頼 - ${dialog.name}`} onClose={() => setDialog(null)} className="modal--wide">
          <TeamRequestCreatePanel patientId={dialog.patientId} teamId={astTeam.id} onSaved={() => setDialog(null)} />
        </Modal>
      )}
      {dialog?.kind === "notify" && <NotifyModal row={dialog.row} name={dialog.name} onClose={() => setDialog(null)} />}
    </div>
  );
}

type RowActions = (patientId: string, name: string) => { teamRequest?: () => void; intervening: boolean };

function PatientCells({ patientId, place }: { patientId: string; place?: PatientPlace }) {
  const returnLinkState = useReturnLinkState();
  const patient = place?.patient;
  return (
    <>
      <td className="lab-worklist__compact">{place?.wardName || "-"}</td>
      <td className="lab-worklist__compact">{patient ? patientNumberOf(patient) || "-" : "-"}</td>
      <td>
        <Link to={`/patients/${patientId}/karte`} state={returnLinkState}>
          {patient ? displayName(patient) : patientId}
        </Link>
      </td>
    </>
  );
}

function ActionCells({ actions, patientId }: { actions: ReturnType<RowActions>; patientId: string }) {
  const returnLinkState = useReturnLinkState();
  return (
    <>
      <td className="lab-worklist__compact">{actions.intervening ? "介入中" : "-"}</td>
      <td className="lab-worklist__actions">
        {actions.teamRequest && (
          <button type="button" className="rp-card__compact-button" onClick={actions.teamRequest}>
            チーム依頼
          </button>
        )}
        <Link className="button rp-card__compact-button" to={`/patients/${patientId}/karte`} state={returnLinkState}>
          カルテ
        </Link>
      </td>
    </>
  );
}

function CourseTab({
  mode,
  today: todayValue,
  places,
  rowActions,
}: {
  mode: "usage" | "long";
  today: string;
  places: Map<string, PatientPlace>;
  rowActions: RowActions;
}) {
  const hospital = useHospitalAntimicrobialCourses(todayValue);
  // 入院中で、今日に続いている連続投与(今日か昨日まで投与している)。
  const ongoing = useMemo(
    () => hospital.courses.filter((course) => places.has(course.patientId) && addDays(course.end, 1) >= todayValue),
    [hospital.courses, places, todayValue],
  );
  const attributes = useMedicineAttributeLookup(ongoing.map((course) => course.medicineCode));
  const rows = useMemo(
    () =>
      ongoing
        .map((course) => ({
          course,
          day: courseDayNumber(course, todayValue),
          category: antimicrobialCategoryOf(course.medicineCode, attributes),
        }))
        .filter((row) => (mode === "usage" ? row.category !== "none" : row.day >= LONG_COURSE_DAYS))
        .sort((a, b) => b.day - a.day),
    [ongoing, attributes, mode, todayValue],
  );
  const patientIds = rows.map((row) => row.course.patientId);
  const notifications = useAntimicrobialNotifications(mode === "usage" ? patientIds : []);
  const tdm = useTdmResults(patientIds, todayValue);

  function notificationLabel(course: AntimicrobialCourse): string {
    const task = (notifications.data ?? []).find(
      (t) =>
        t.for?.reference === `Patient/${course.patientId}` &&
        (antimicrobialNotificationRowOf(t, undefined).medicines.includes(course.name) ||
          t.description?.includes(course.name)),
    );
    if (!task) return "未届出";
    return ANTIMICROBIAL_NOTIFICATION_STATE_LABEL[antimicrobialNotificationRowOf(task, undefined).state];
  }

  return (
    <>
      <ErrorBanner error={hospital.error} />
      <TruncatedNotice show={hospital.truncated}>オーダーが多いため、一部の患者が欠けている可能性があります。</TruncatedNotice>
      {hospital.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <div className="lab-worklist-wrap">
          <table className="lab-worklist">
            <thead>
              <tr>
                <th className="lab-worklist__compact">病棟</th>
                <th className="lab-worklist__compact">患者番号</th>
                <th>患者氏名</th>
                <th>抗菌薬</th>
                <th className="lab-worklist__compact">区分</th>
                <th className="lab-worklist__compact">開始日</th>
                <th className="lab-worklist__compact">日数</th>
                {mode === "usage" && <th className="lab-worklist__compact">届出</th>}
                {tdm.hasItems && <th>血中濃度</th>}
                <th className="lab-worklist__compact">AST</th>
                <th className="lab-worklist__actions"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ course, day, category }) => {
                const place = places.get(course.patientId);
                const name = place?.patient ? displayName(place.patient) : course.patientId;
                return (
                  <tr key={`${course.patientId}|${course.ingredient}`}>
                    <PatientCells patientId={course.patientId} place={place} />
                    <td>{course.name}</td>
                    <td className="lab-worklist__compact">{ANTIMICROBIAL_CATEGORY_LABEL[category] || "-"}</td>
                    <td className="lab-worklist__compact">{course.start}</td>
                    <td
                      className={`lab-worklist__compact${
                        day >= VERY_LONG_COURSE_DAYS ? " ast-worklist__days--alert" : day >= LONG_COURSE_DAYS ? " ast-worklist__days--warn" : ""
                      }`}
                    >
                      {day} 日目
                    </td>
                    {mode === "usage" && <td className="lab-worklist__compact">{notificationLabel(course)}</td>}
                    {tdm.hasItems && <td>{tdm.byPatient.get(course.patientId)?.join(" / ") || "-"}</td>}
                    <ActionCells actions={rowActions(course.patientId, name)} patientId={course.patientId} />
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="master-search__empty">
                    {mode === "usage" ? "特定抗菌薬を投与中の入院患者はいません" : "7 日以上続けている抗菌薬はありません"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </div>
      )}
    </>
  );
}

function BloodCultureTab({
  today: todayValue,
  places,
  rowActions,
}: {
  today: string;
  places: Map<string, PatientPlace>;
  rowActions: RowActions;
}) {
  const cultures = useRecentPositiveBloodCultures(todayValue);
  const hospital = useHospitalAntimicrobialCourses(todayValue);
  const rows = cultures.results.filter((result) => places.has(result.patientId));

  function currentAntimicrobials(patientId: string): string {
    return hospital.courses
      .filter((course) => course.patientId === patientId && addDays(course.end, 1) >= todayValue)
      .map((course) => course.name)
      .join("、");
  }

  return (
    <>
      <ErrorBanner error={cultures.error} />
      <TruncatedNotice show={cultures.truncated} />
      {cultures.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <div className="lab-worklist-wrap">
          <table className="lab-worklist">
            <thead>
              <tr>
                <th className="lab-worklist__compact">病棟</th>
                <th className="lab-worklist__compact">患者番号</th>
                <th>患者氏名</th>
                <th className="lab-worklist__compact">採取日</th>
                <th className="lab-worklist__compact">材料</th>
                <th>分離菌</th>
                <th className="lab-worklist__compact">報告</th>
                <th>投与中の抗菌薬</th>
                <th className="lab-worklist__compact">AST</th>
                <th className="lab-worklist__actions"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((result) => {
                const place = places.get(result.patientId);
                const name = place?.patient ? displayName(place.patient) : result.patientId;
                return (
                  <tr key={result.reportId}>
                    <PatientCells patientId={result.patientId} place={place} />
                    <td className="lab-worklist__compact">{result.specimenDate || "-"}</td>
                    <td className="lab-worklist__compact">{result.specimenName || "-"}</td>
                    <td>{result.organisms.join("、") || "培養陽性"}</td>
                    <td className="lab-worklist__compact">{result.final ? "最終" : "中間"}</td>
                    <td>{currentAntimicrobials(result.patientId) || "なし"}</td>
                    <ActionCells actions={rowActions(result.patientId, name)} patientId={result.patientId} />
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="master-search__empty">
                    直近 14 日に採取した血液培養に陽性はありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </div>
      )}
    </>
  );
}

function NotifyTab({
  isAstMember,
  onNotify,
}: {
  isAstMember: boolean;
  onNotify: (row: AntimicrobialNotificationRow, name: string) => void;
}) {
  const open = useOpenAntimicrobialNotifications();
  const approve = useApproveAntimicrobialNotification();
  const returnLinkState = useReturnLinkState();
  const rows = (open.data?.tasks ?? []).map((task) =>
    antimicrobialNotificationRowOf(task, open.data?.patients.get(task.for?.reference?.split("/").pop() ?? "")),
  );

  return (
    <>
      <ErrorBanner error={open.error} />
      <ErrorBanner error={approve.error} />
      <TruncatedNotice show={open.data?.truncated} />
      {open.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <div className="lab-worklist-wrap">
          <table className="lab-worklist">
            <thead>
              <tr>
                <th className="lab-worklist__compact">患者番号</th>
                <th>患者氏名</th>
                <th className="lab-worklist__compact">区分</th>
                <th className="lab-worklist__compact">種別</th>
                <th>薬剤</th>
                <th className="lab-worklist__compact">開始日</th>
                <th className="lab-worklist__compact">依頼医</th>
                <th className="lab-worklist__compact">状態</th>
                <th className="lab-worklist__actions"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = row.patient ? displayName(row.patient) : row.patientId;
                return (
                  <tr key={row.task.id}>
                    <td className="lab-worklist__compact">{row.patient ? patientNumberOf(row.patient) || "-" : "-"}</td>
                    <td>
                      <Link to={`/patients/${row.patientId}/karte`} state={returnLinkState}>
                        {name}
                      </Link>
                    </td>
                    <td className="lab-worklist__compact">{ANTIMICROBIAL_CATEGORY_LABEL[row.category]}</td>
                    <td className="lab-worklist__compact">{row.kind || "-"}</td>
                    <td>{row.medicines}</td>
                    <td className="lab-worklist__compact">{row.startDate || "-"}</td>
                    <td className="lab-worklist__compact">{row.ownerName || "-"}</td>
                    <td className="lab-worklist__compact">{ANTIMICROBIAL_NOTIFICATION_STATE_LABEL[row.state]}</td>
                    <td className="lab-worklist__actions">
                      {row.state === "pending" && row.orderId && (
                        <button type="button" className="rp-card__compact-button" onClick={() => onNotify(row, name)}>
                          届出書
                        </button>
                      )}
                      {row.state === "awaiting-approval" && isAstMember && (
                        <button
                          type="button"
                          className="rp-card__compact-button"
                          disabled={approve.isPending}
                          onClick={() => approve.mutate(row.task)}
                        >
                          許可
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="master-search__empty">
                    未対応の届出はありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </div>
      )}
    </>
  );
}

/** 届出書の記入。保存で届出の通知を閉じる(許可制は許可待ちにする)。 */
function NotifyModal({ row, name, onClose }: { row: AntimicrobialNotificationRow; name: string; onClose: () => void }) {
  const enterer = useOrderEnterer();
  const actor = enterer ? { practitionerId: enterer.practitionerId, display: enterer.display } : null;
  return (
    <Modal title={`特定抗菌薬の届出 - ${name}`} onClose={onClose} className="modal--wide">
      <QuestionnaireResponseCreatePanel
        patientId={row.patientId}
        basedOn={[{ reference: `ServiceRequest/${row.orderId}` }]}
        defaultQuestionnaireCanonical={AST_NOTIFY_QUESTIONNAIRE_URL}
        extraEntries={(responseReference) => antimicrobialNotifiedEntries([row.task], responseReference, actor)}
        onSaved={onClose}
      />
    </Modal>
  );
}

function SummaryTab() {
  const thisMonth = today().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [wardId, setWardId] = useState("");
  const from = `${month}-01`;
  const monthEnd = addDays(addMonths(from, 1), -1);
  const to = monthEnd < today() ? monthEnd : today();

  const encounters = useEncountersInRange(from, to);
  const bedWards = useBedWardIndex();
  const administrations = useAntimicrobialAdministrations(from, to);
  const codes = useMemo(
    () => [...new Set(administrations.administrations.map((a) => a.medicineCode))],
    [administrations.administrations],
  );
  const attributes = useMedicineAttributeLookup(codes);
  const conversions = useMedicineDoseFactors(codes);

  const wardOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const place of bedWards.bedWards.values()) byId.set(place.wardId, place.wardName);
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [bedWards.bedWards]);

  const summary = useMemo(() => {
    const bedIds = new Set<string>();
    for (const [bedId, place] of bedWards.bedWards) if (!wardId || place.wardId === wardId) bedIds.add(bedId);
    const presence = patientsByDayAtBeds({ encounters: encounters.data?.encounters ?? [], bedIds, from, to });
    const ddd = new Map([...attributes].map(([code, flags]) => [code, flags.ddd]));
    return summarizeAntimicrobialUsage({
      administrations: administrations.administrations,
      presence,
      ddd,
      convert: (dose, unit, code, target) => convertDose(dose, unit, code, target, conversions.data),
    });
  }, [bedWards.bedWards, wardId, encounters.data, from, to, attributes, administrations.administrations, conversions.data]);

  const wardName = wardOptions.find((w) => w.id === wardId)?.name ?? "全体";
  const format = (value: number | null) => (value == null ? "-" : value.toFixed(2));

  function handleCsv() {
    const header = ["抗菌薬", "投与患者数", "投与日数", "DOT", "DDD 数", "AUD", "換算できない投与"];
    const rows = summary.rows.map((row) => [
      row.name,
      String(row.patients),
      String(row.days),
      format(row.dot),
      format(row.ddds),
      format(row.aud),
      String(row.unconverted),
    ]);
    rows.push([
      "合計",
      String(summary.total.patients),
      String(summary.total.days),
      format(summary.total.dot),
      "",
      format(summary.total.aud),
      String(summary.total.unconverted),
    ]);
    downloadBlob(csvBlob(header, rows), `抗菌薬使用量_${month}_${wardName}.csv`);
  }

  const loading = encounters.isLoading || bedWards.isLoading || administrations.isLoading;

  return (
    <>
      <div className="patient-search-form">
        <label>
          月
          <input type="month" value={month} max={thisMonth} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
        <label>
          病棟
          <select value={wardId} onChange={(e) => setWardId(e.target.value)}>
            <option value="">全体</option>
            {wardOptions.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {ward.name}
              </option>
            ))}
          </select>
        </label>
        <div className="patient-search-form__actions">
          <button type="button" onClick={handleCsv} disabled={loading || summary.rows.length === 0}>
            CSV
          </button>
        </div>
      </div>
      <ErrorBanner error={encounters.error ?? bedWards.error ?? administrations.error} />
      <TruncatedNotice show={encounters.data?.truncated || administrations.truncated} />
      {loading ? (
        <p>読み込み中...</p>
      ) : (
        <div className="lab-worklist-wrap">
          <table className="lab-worklist ast-summary">
            <caption className="nursing-acuity-report__caption">
              {month.replace("-", "/")} {wardName} 在院患者延日数 {summary.patientDays}
            </caption>
            <thead>
              <tr>
                <th>抗菌薬</th>
                <th className="ast-summary__number">投与患者数</th>
                <th className="ast-summary__number">投与日数</th>
                <th className="ast-summary__number">DOT</th>
                <th className="ast-summary__number">DDD 数</th>
                <th className="ast-summary__number">AUD</th>
                <th className="ast-summary__number">換算できない投与</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={row.ingredient}>
                  <td>{row.name}</td>
                  <td className="ast-summary__number">{row.patients}</td>
                  <td className="ast-summary__number">{row.days}</td>
                  <td className="ast-summary__number">{format(row.dot)}</td>
                  <td className="ast-summary__number">{format(row.ddds)}</td>
                  <td className="ast-summary__number">{format(row.aud)}</td>
                  <td className="ast-summary__number">{row.unconverted || "-"}</td>
                </tr>
              ))}
              {summary.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="master-search__empty">
                    この月に入院患者への抗菌薬の注射の実施はありません
                  </td>
                </tr>
              )}
            </tbody>
            {summary.rows.length > 0 && (
              <tfoot>
                <tr>
                  <th>合計</th>
                  <td className="ast-summary__number">{summary.total.patients}</td>
                  <td className="ast-summary__number">{summary.total.days}</td>
                  <td className="ast-summary__number">{format(summary.total.dot)}</td>
                  <td className="ast-summary__number"></td>
                  <td className="ast-summary__number">{format(summary.total.aud)}</td>
                  <td className="ast-summary__number">{summary.total.unconverted || "-"}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </>
  );
}
