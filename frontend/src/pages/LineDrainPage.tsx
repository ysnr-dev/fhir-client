import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLineDrainTypes } from "../api/masterQueries";
import { useBedWardIndex, useEncountersInRange, useWardLineDrains, useWardOptions } from "../api/queries";
import type { LineDrainKind } from "../api/masterClient";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { LineDrainRemovalModal } from "../components/LineDrainRemovalModal";
import { LineDrainSiteModal } from "../components/LineDrainSiteModal";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { wardPatientsByDay } from "../fhir/bedScheduleHelpers";
import {
  daysInserted,
  DEVICE_DAY_GROUPS,
  isOverWarnDays,
  LINE_DRAIN_KIND_OPTIONS,
  lineDrainMonthStats,
  siteObservationSummary,
  type LineDrainRecord,
} from "../fhir/lineDrainHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { displayName } from "../fhir/patientHelpers";
import { useWardInpatients } from "../hooks/useWardInpatients";
import { addDays, addMonths, dateTimeLabel, diffDays, localDay, shortDate, today } from "../lib/dates";

// ライン・ドレーン管理(docs/line-drain-design.md §4.5)。「留置中」タブは病棟 × 日の留置中の管、
// 「デバイス日数」タブは病棟 × 月のデバイス日数(CLABSI / CAUTI / VAP の分母)。行の観察・抜去は
// プロファイル区画と同じモーダルで書く(カルテへは移らない)。

type Tab = "current" | "days";

/** 最終観察がこの日数以上前なら赤く出す。 */
const OBSERVATION_STALE_DAYS = 3;

export function LineDrainPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "days" ? "days" : "current";
  const wardId = searchParams.get("ward") ?? "";
  const date = searchParams.get("date") || today();
  const kind = (searchParams.get("kind") ?? "") as LineDrainKind | "";
  const wardOptions = useWardOptions();

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
        <h1>ライン・ドレーン管理</h1>
      </div>

      <div className="order-select__tabs" role="tablist">
        {(
          [
            ["current", "留置中"],
            ["days", "デバイス日数"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => setParams({ tab: key === "current" ? "" : key })}
          >
            {label}
          </button>
        ))}
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          {tab === "current" ? "日付" : "月"}
          {tab === "current" ? (
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
        {tab === "current" && (
          <label>
            区分
            <select value={kind} onChange={(e) => setParams({ kind: e.target.value })}>
              <option value="">すべて</option>
              {LINE_DRAIN_KIND_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
        )}
      </form>

      <ErrorBanner error={wardOptions.error} />

      {!wardId ? (
        <p className="patient-table__empty">病棟を選んでください。</p>
      ) : tab === "current" ? (
        <CurrentTab date={date} wardId={wardId} kind={kind} />
      ) : (
        <DaysTab month={date.slice(0, 7)} wardId={wardId} />
      )}
    </div>
  );
}

function CurrentTab({ date, wardId, kind }: { date: string; wardId: string; kind: LineDrainKind | "" }) {
  const inpatients = useWardInpatients(date, wardId);
  const patientIds = useMemo(() => inpatients.rows.map((row) => row.patientId), [inpatients.rows]);
  const lineDrains = useWardLineDrains(patientIds, { inProgressOnly: true });
  const types = useLineDrainTypes();
  const todayValue = today();
  const [dialog, setDialog] = useState<{ kind: "remove" | "site"; record: LineDrainRecord; patientId: string } | null>(null);

  const rows = useMemo(() => {
    const byPatient = new Map(inpatients.rows.map((row) => [row.patientId, row]));
    return (lineDrains.data?.records ?? [])
      .filter((record) => !kind || record.kind === kind)
      .map((record) => {
        const patientId = record.procedure.subject.reference?.split("/").pop() ?? "";
        return { record, patientId, row: byPatient.get(patientId) };
      })
      .sort((a, b) => (a.row?.bedLabel ?? "").localeCompare(b.row?.bedLabel ?? "", "ja", { numeric: true }));
  }, [lineDrains.data, inpatients.rows, kind]);

  // 保存のたびに読み直された最新の記録をモーダルに出す。
  const dialogRecord = dialog
    ? (lineDrains.data?.records.find((r) => r.id === dialog.record.id) ?? dialog.record)
    : null;

  return (
    <>
      <ErrorBanner error={inpatients.error} />
      <ErrorBanner error={lineDrains.error} />
      <TruncatedNotice show={inpatients.truncated || lineDrains.data?.truncated} />
      {inpatients.isLoading || lineDrains.isLoading ? (
        <p>読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="patient-table__empty">留置中のライン・ドレーンはありません。</p>
      ) : (
        <div className="lab-worklist-wrap sticky-table-wrap">
          <table className="lab-worklist sticky-table">
            <thead>
              <tr>
                <th className="sticky-table__fix-1">病室</th>
                <th className="sticky-table__fix-2">患者氏名</th>
                <th>種別</th>
                <th>部位</th>
                <th>デバイス</th>
                <th className="lab-worklist__compact">挿入日</th>
                <th className="lab-worklist__compact">留置日数</th>
                <th>最終観察</th>
                <th>挿入者</th>
                <th className="lab-worklist__actions sticky-table__fix-actions"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ record, patientId, row }) => {
                const latest = record.observations[0];
                const over = isOverWarnDays(record, types, todayValue);
                const stale = !latest || diffDays(localDay(latest.effectiveAt), todayValue) >= OBSERVATION_STALE_DAYS;
                return (
                  <tr key={record.id}>
                    <td className="sticky-table__fix-1">{row?.bedLabel ?? "-"}</td>
                    <td className="sticky-table__fix-2">
                      {row?.patient ? (
                        <Link to={`/patients/${patientId}/karte?tab=profile`}>{displayName(row.patient)}</Link>
                      ) : (
                        patientId
                      )}
                    </td>
                    <td>{record.typeName}</td>
                    <td>{record.bodySite}</td>
                    <td>{record.deviceLabel}</td>
                    <td className="lab-worklist__compact">{shortDate(localDay(record.insertedAt))}</td>
                    <td className={over ? "lab-worklist__compact line-drain__days--over" : "lab-worklist__compact"}>
                      {daysInserted(record, todayValue)}
                    </td>
                    <td className={stale ? "line-drain__days--over" : undefined}>
                      {latest ? `${dateTimeLabel(latest.effectiveAt)} ${siteObservationSummary(latest)}` : "なし"}
                    </td>
                    <td>{record.performer?.display ?? ""}</td>
                    <td className="lab-worklist__actions sticky-table__fix-actions">
                      <button
                        type="button"
                        className="rp-card__compact-button"
                        onClick={() => setDialog({ kind: "site", record, patientId })}
                      >
                        観察
                      </button>
                      <button
                        type="button"
                        className="rp-card__compact-button"
                        onClick={() => setDialog({ kind: "remove", record, patientId })}
                      >
                        抜去
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === "remove" && dialogRecord && (
        <LineDrainRemovalModal record={dialogRecord} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "site" && dialogRecord && (
        <LineDrainSiteModal patientId={dialog.patientId} record={dialogRecord} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

function DaysTab({ month, wardId }: { month: string; wardId: string }) {
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
  const lineDrains = useWardLineDrains(patientIds, { from, to });
  // 当月は今日までで数える(先の日の在院は見込みで、デバイス日数の分母にしない)。
  const todayValue = today();
  const days = useMemo(() => [...presence.keys()].filter((day) => day <= todayValue), [presence, todayValue]);
  const stats = useMemo(
    () => lineDrainMonthStats(presence, lineDrains.data?.records ?? [], days),
    [presence, lineDrains.data, days],
  );
  const ratio = (numerator: number, denominator: number) =>
    denominator > 0 ? (numerator / denominator).toFixed(2) : "-";
  // 分母が欠けると使用比が狂うので、読み切れていないときは表を出さない。
  const truncated = Boolean(encounters.data?.truncated || lineDrains.data?.truncated);

  return (
    <>
      <ErrorBanner error={encounters.error} />
      <ErrorBanner error={bedWards.error} />
      <ErrorBanner error={lineDrains.error} />
      {encounters.isLoading || bedWards.isLoading || lineDrains.isLoading ? (
        <p>読み込み中...</p>
      ) : truncated ? (
        <TruncatedNotice show>入院または留置の記録を読み切れていないため、デバイス日数を出せません。</TruncatedNotice>
      ) : (
        <div className="lab-worklist-wrap">
          <table className="lab-worklist nursing-acuity-report">
            <caption className="nursing-acuity-report__caption">
              {month.replace("-", "/")} 患者延べ日数 {stats.patientDays}
            </caption>
            <thead>
              <tr>
                <th></th>
                <th className="lab-worklist__compact">デバイス日数</th>
                <th className="lab-worklist__compact">新規挿入</th>
                <th className="lab-worklist__compact">抜去</th>
                <th className="lab-worklist__compact">計画外抜去</th>
                <th className="lab-worklist__compact">使用比</th>
              </tr>
            </thead>
            <tbody>
              {DEVICE_DAY_GROUPS.map((group) => {
                const row = stats.groups[group.key];
                return (
                  <tr key={group.key}>
                    <th className="nursing-acuity-report__label">{group.label}</th>
                    <td className="nursing-acuity-report__value">{row.deviceDays}</td>
                    <td className="nursing-acuity-report__value">{row.inserted}</td>
                    <td className="nursing-acuity-report__value">{row.removed}</td>
                    <td className="nursing-acuity-report__value">{row.unplannedRemoved}</td>
                    <td className="nursing-acuity-report__value">{ratio(row.deviceDays, stats.patientDays)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
