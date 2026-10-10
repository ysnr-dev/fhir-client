import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useBedWardIndex,
  useCareTeams,
  useEncountersInRange,
  useFacilitySettings,
  usePressureUlcerResponses,
  useWardOptions,
} from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { PressureUlcerHistoryModal } from "../components/PressureUlcerHistoryModal";
import { QuestionnaireResponseCreatePanel } from "../components/QuestionnaireResponsePanels";
import { TeamRequestCreatePanel } from "../components/TeamRequestPanels";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { wardPatientsByDay } from "../fhir/bedScheduleHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { displayName } from "../fhir/patientHelpers";
import {
  DEFAULT_PRESSURE_ULCER,
  evaluationOverdue,
  firstEvaluationsByWound,
  latestEvaluationsByWound,
  pressureUlcerMonthStats,
  woundEvaluations,
  woundOpenOn,
} from "../fhir/pressureUlcerHelpers";
import { useWardInpatients } from "../hooks/useWardInpatients";
import { addDays, addMonths, today } from "../lib/dates";

// 褥瘡管理(docs/care-team-design.md §6)。DESIGN-R 評価(テンプレート PU_DESIGNR_01 の回答)から、
// 「保有患者」タブは病棟 × 日の保有している創の一覧、「発生率」タブは病棟 × 月の発生率・有病率を出す。
// 保有患者の行の「評価」は DESIGN-R のテンプレートを選択済みで、「チーム依頼」は褥瘡対策チームを選択済みで、
// どちらもこの画面のモーダルで書く(カルテへは移らない)。

type Tab = "patients" | "rate";

export function PressureUlcerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "rate" ? "rate" : "patients";
  const wardId = searchParams.get("ward") ?? "";
  const date = searchParams.get("date") || today();
  const facility = useFacilitySettings();
  const templateUrl = (facility.data?.pressure_ulcer ?? DEFAULT_PRESSURE_ULCER).template;
  const wardOptions = useWardOptions();
  // 褥瘡対策チームが 1 つあれば、保有患者の行からそのチームへの依頼を開ける。
  const teams = useCareTeams({ kind: "pressure-ulcer" });
  const teamId = teams.data?.length === 1 ? teams.data[0].id : undefined;

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  function setParams(next: Record<string, string>, replace = false) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace });
  }

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || wardId) return;
    const first = wardOptions.wards[0];
    if (!first?.id) return;
    initialized.current = true;
    setParams({ ward: first.id }, true);
    // 初回に一度だけ動けばよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardId, wardOptions.wards]);

  return (
    <div className="page">
      <div className="page__header">
        <h1>褥瘡管理</h1>
      </div>

      <div className="order-select__tabs" role="tablist">
        {(
          [
            ["patients", "保有患者"],
            ["rate", "発生率"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => setParams({ tab: key === "patients" ? "" : key })}
          >
            {label}
          </button>
        ))}
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          {tab === "patients" ? "日付" : "月"}
          {tab === "patients" ? (
            <DateStepper value={date} onChange={(value) => value && setParams({ date: value })} />
          ) : (
            <span className="inpatient__date">
              <button type="button" onClick={() => setParams({ date: addMonths(date, -1) })} aria-label="前の月">
                &lt;
              </button>
              <input
                type="month"
                value={date.slice(0, 7)}
                onChange={(e) => e.target.value && setParams({ date: `${e.target.value}-01` })}
              />
              <button type="button" onClick={() => setParams({ date: addMonths(date, 1) })} aria-label="次の月">
                &gt;
              </button>
            </span>
          )}
        </label>
        <label>
          病棟
          <select value={wardId} onChange={(e) => setParams({ ward: e.target.value })}>
            {wardOptions.wards.map((w) => (
              <option key={w.id} value={w.id}>
                {locationDisplayName(w)}
              </option>
            ))}
          </select>
        </label>
      </form>

      <ErrorBanner error={wardOptions.error} />
      <ErrorBanner error={facility.error} />

      {!wardId ? (
        <p className="patient-table__empty">病棟を選んでください。</p>
      ) : tab === "patients" ? (
        <PatientsTab date={date} wardId={wardId} templateUrl={templateUrl} teamId={teamId} />
      ) : (
        <RateTab month={date.slice(0, 7)} wardId={wardId} templateUrl={templateUrl} />
      )}
    </div>
  );
}

function PatientsTab({ date, wardId, templateUrl, teamId }: { date: string; wardId: string; templateUrl: string; teamId?: string }) {
  const inpatients = useWardInpatients(date, wardId);
  const patientIds = useMemo(() => inpatients.rows.map((row) => row.patientId), [inpatients.rows]);
  const responses = usePressureUlcerResponses(templateUrl, patientIds, date);
  const todayValue = today();

  const rows = useMemo(() => {
    const first = firstEvaluationsByWound(responses.data?.responses ?? []);
    const latest = latestEvaluationsByWound(responses.data?.responses ?? []);
    return [...latest.entries()]
      .filter(([key, evaluation]) => woundOpenOn(first.get(key) ?? evaluation, evaluation, date))
      .map(([key, evaluation]) => ({
        key,
        evaluation,
        first: first.get(key) ?? evaluation,
        row: inpatients.rows.find((r) => r.patientId === evaluation.patientId),
      }))
      .sort((a, b) => (a.row?.bedLabel ?? "").localeCompare(b.row?.bedLabel ?? "", "ja", { numeric: true }));
  }, [responses.data, inpatients.rows, date]);

  // 開いているモーダル(評価 / チーム依頼)と対象の患者。
  const [dialog, setDialog] = useState<
    { kind: "evaluate" | "team-request" | "history"; patientId: string; name: string; woundKey?: string; site?: string } | null
  >(null);

  return (
    <>
      <ErrorBanner error={inpatients.error} />
      <ErrorBanner error={responses.error} />
      <TruncatedNotice show={inpatients.truncated || responses.data?.truncated} />
      {inpatients.isLoading || responses.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table pressure-ulcer-list">
              <thead>
                <tr>
                  <th className="sticky-table__fix-1">病室</th>
                  <th className="sticky-table__fix-2">患者氏名</th>
                  <th>部位</th>
                  <th className="lab-worklist__compact">発生区分</th>
                  <th className="lab-worklist__compact">発生日</th>
                  <th className="lab-worklist__compact">深さ</th>
                  <th className="lab-worklist__compact">合計</th>
                  <th className="lab-worklist__compact">重症度</th>
                  <th className="lab-worklist__compact">最終評価</th>
                  <th>評価者</th>
                  <th className="lab-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ key, evaluation, first, row }) => (
                  <tr key={key}>
                    <td className="sticky-table__fix-1">{row?.bedLabel ?? "-"}</td>
                    <td className="sticky-table__fix-2">
                      {row?.patient ? (
                        <Link to={`/patients/${evaluation.patientId}/karte`}>{displayName(row.patient)}</Link>
                      ) : (
                        evaluation.patientId
                      )}
                    </td>
                    <td>{evaluation.siteLabel || "-"}</td>
                    <td className="lab-worklist__compact">
                      {first.onsetKind === "acquired" ? "院内発生" : first.onsetKind === "brought" ? "持込" : "-"}
                    </td>
                    <td className="lab-worklist__compact">{first.onsetDate || "-"}</td>
                    <td className="lab-worklist__compact">{evaluation.depth || "-"}</td>
                    <td className="lab-worklist__compact">{evaluation.total ?? "-"}</td>
                    <td className="lab-worklist__compact">
                      {evaluation.severity === "重症" ? <span className="micro-result__badge">重症</span> : evaluation.severity || "-"}
                    </td>
                    <td
                      className={`lab-worklist__compact${evaluationOverdue(evaluation, todayValue) ? " team-worklist__due" : ""}`}
                      title={evaluationOverdue(evaluation, todayValue) ? "最終評価から 7 日以上" : undefined}
                    >
                      {evaluation.authored || "-"}
                    </td>
                    <td>{evaluation.authorName || "-"}</td>
                    <td className="lab-worklist__actions sticky-table__fix-actions">
                      <button
                        type="button"
                        onClick={() =>
                          setDialog({
                            kind: "history",
                            patientId: evaluation.patientId,
                            name: row?.patient ? displayName(row.patient) : evaluation.patientId,
                            woundKey: key,
                            site: evaluation.siteLabel,
                          })
                        }
                      >
                        経過
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDialog({
                            kind: "evaluate",
                            patientId: evaluation.patientId,
                            name: row?.patient ? displayName(row.patient) : evaluation.patientId,
                          })
                        }
                      >
                        評価
                      </button>
                      {teamId && (
                        <button
                          type="button"
                          onClick={() =>
                            setDialog({
                              kind: "team-request",
                              patientId: evaluation.patientId,
                              name: row?.patient ? displayName(row.patient) : evaluation.patientId,
                            })
                          }
                        >
                          チーム依頼
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="master-search__empty">
                      この日に褥瘡を保有している患者はいません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">
            保有 {new Set(rows.map((r) => r.evaluation.patientId)).size} / {inpatients.rows.length} 人({rows.length} 創)
          </p>
        </>
      )}

      {/* 保存したら閉じる。評価は回答の検索キーが読み直されて一覧に反映される。 */}
      {dialog?.kind === "evaluate" && (
        <Modal title={`褥瘡 DESIGN-R評価 - ${dialog.name}`} onClose={() => setDialog(null)} className="modal--wide">
          <QuestionnaireResponseCreatePanel
            patientId={dialog.patientId}
            defaultQuestionnaireCanonical={templateUrl}
            onSaved={() => setDialog(null)}
          />
        </Modal>
      )}
      {dialog?.kind === "history" && dialog.woundKey && (
        <PressureUlcerHistoryModal
          title={`褥瘡の経過 - ${dialog.name}(${dialog.site || "部位なし"})`}
          evaluations={woundEvaluations(responses.data?.responses ?? [], dialog.woundKey)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "team-request" && teamId && (
        <Modal title={`チーム依頼 - ${dialog.name}`} onClose={() => setDialog(null)} className="modal--wide">
          <TeamRequestCreatePanel patientId={dialog.patientId} teamId={teamId} onSaved={() => setDialog(null)} />
        </Modal>
      )}
    </>
  );
}

function RateTab({ month, wardId, templateUrl }: { month: string; wardId: string; templateUrl: string }) {
  const from = `${month}-01`;
  const to = addDays(addMonths(from, 1), -1);
  const encounters = useEncountersInRange(from, to);
  const bedWards = useBedWardIndex();
  const presence = useMemo(
    () =>
      wardPatientsByDay({
        encounters: encounters.data?.encounters ?? [],
        bedPlaces: bedWards.bedWards,
        wardId,
        from,
        to,
      }),
    [encounters.data, bedWards.bedWards, wardId, from, to],
  );
  const patientIds = useMemo(() => [...new Set([...presence.values()].flatMap((set) => [...set]))], [presence]);
  const responses = usePressureUlcerResponses(templateUrl, patientIds, to);
  const todayValue = today();
  const stats = useMemo(
    () =>
      pressureUlcerMonthStats({
        presence,
        responses: responses.data?.responses ?? [],
        from,
        to,
        today: todayValue,
      }),
    [presence, responses.data, from, to, todayValue],
  );
  const percent = (numerator: number, denominator: number) =>
    denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : "-";

  return (
    <>
      <ErrorBanner error={encounters.error} />
      <ErrorBanner error={bedWards.error} />
      <ErrorBanner error={responses.error} />
      <TruncatedNotice show={encounters.data?.truncated || responses.data?.truncated} />
      {encounters.isLoading || bedWards.isLoading || responses.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <div className="lab-worklist-wrap">
          <table className="lab-worklist nursing-acuity-report">
            <caption className="nursing-acuity-report__caption">{month.replace("-", "/")}</caption>
            <tbody>
              <tr>
                <th className="nursing-acuity-report__label">在院患者数(実人数)</th>
                <td className="nursing-acuity-report__value">{stats.patients}</td>
              </tr>
              <tr>
                <th className="nursing-acuity-report__label">持込(月初に保有)</th>
                <td className="nursing-acuity-report__value">{stats.brought}</td>
              </tr>
              <tr>
                <th className="nursing-acuity-report__label">院内新規発生</th>
                <td className="nursing-acuity-report__value">{stats.acquired}</td>
              </tr>
              <tr>
                <th className="nursing-acuity-report__label">うち d2 以上</th>
                <td className="nursing-acuity-report__value">{stats.acquiredD2}</td>
              </tr>
              <tr>
                <th className="nursing-acuity-report__label">褥瘡発生率(院内新規発生 ÷ 在院患者数)</th>
                <td className="nursing-acuity-report__value">{percent(stats.acquired, stats.patients)}</td>
              </tr>
              <tr>
                <th className="nursing-acuity-report__label">d2 以上の褥瘡発生率</th>
                <td className="nursing-acuity-report__value">{percent(stats.acquiredD2, stats.patients)}</td>
              </tr>
              <tr>
                <th className="nursing-acuity-report__label">月末の保有患者 / 在院患者</th>
                <td className="nursing-acuity-report__value">
                  {stats.prevalent} / {stats.prevalentBase}
                </td>
              </tr>
              <tr>
                <th className="nursing-acuity-report__label">褥瘡有病率(月末)</th>
                <td className="nursing-acuity-report__value">{percent(stats.prevalent, stats.prevalentBase)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
